import { createHash } from "node:crypto";
import { RpcClient, type RpcEvent, type RpcClientOptions } from "./rpc-client.js";
import type { AgentConfig } from "./config.js";

function sessionIdFor(threadTs: string): string {
  return "slack-" + createHash("sha1").update(threadTs).digest("hex").slice(0, 12);
}

export interface SessionHandlers {
  onEvent: (event: RpcEvent) => void;
  onExit?: () => void;
}

export class Session {
  readonly threadTs: string;
  private client: RpcClient | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private handlers: SessionHandlers;
  private readonly config: AgentConfig;
  streaming = false;

  constructor(threadTs: string, config: AgentConfig, handlers: SessionHandlers) {
    this.threadTs = threadTs;
    this.config = config;
    this.handlers = handlers;
  }

  setHandlers(handlers: SessionHandlers): void {
    this.handlers = handlers;
  }

  private ensureClient(): RpcClient {
    if (this.client) return this.client;
    this.client = new RpcClient({
      bin: this.config.piBin,
      cwd: this.config.piCwd,
      model: this.config.piModel,
      session: sessionIdFor(this.threadTs),
      onEvent: (event) => this.handleEvent(event),
      onExit: () => { this.client = undefined; this.streaming = false; this.handlers.onExit?.(); },
    });
    return this.client;
  }

  private handleEvent(event: RpcEvent): void {
    if (event.type === "agent_start") this.streaming = true;
    if (event.type === "agent_end") {
      this.streaming = false;
      this.scheduleIdle();
    }
    if (event.type === "extension_ui_request") {
      this.autoApprove(event);
    }
    this.handlers.onEvent(event);
  }

  private autoApprove(event: RpcEvent): void {
    const client = this.client;
    if (!client) return;
    const id = event.id as string | undefined;
    if (!id) return;
    const method = event.method as string;
    switch (method) {
      case "confirm": client.respondUi(id, { confirmed: true }); break;
      case "select": {
        const opts = (event.options as string[] | undefined) ?? [];
        client.respondUi(id, { value: opts[0] });
        break;
      }
      case "input":
      case "editor":
        client.respondUi(id, { value: "" });
        break;
    }
  }

  private clearIdle(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = undefined; }
  }

  private scheduleIdle(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => this.dispose(), this.config.sessionIdleMs);
  }

  async submit(message: string, images?: Array<{ type: string; data: string; mimeType: string }>): Promise<void> {
    this.clearIdle();
    const client = this.ensureClient();
    if (this.streaming) {
      await client.steer(message);
    } else {
      await client.prompt(message, images);
    }
  }

  async getState(): Promise<Record<string, unknown> | null> {
    if (!this.client) return null;
    return this.client.getState();
  }

  dispose(): void {
    this.clearIdle();
    this.client?.dispose();
    this.client = undefined;
    this.streaming = false;
  }
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly config: AgentConfig;

  constructor(config: AgentConfig) { this.config = config; }

  get(threadTs: string, handlers: SessionHandlers): Session {
    let session = this.sessions.get(threadTs);
    if (!session) {
      session = new Session(threadTs, this.config, handlers);
      this.sessions.set(threadTs, session);
    } else {
      session.setHandlers(handlers);
    }
    return session;
  }

  disposeAll(): void {
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
  }
}
