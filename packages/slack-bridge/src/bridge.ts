import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SlackBridgeConfig } from "./config.js";
import { SlackGateway, type InboundHandler, type InboundMessage } from "./slack.js";

export interface SlackTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  postRoot(text: string): Promise<string | undefined>;
  postToThread(threadTs: string, text: string): Promise<string | undefined>;
  updateMessage(ts: string, text: string): Promise<void>;
  setStatus(threadTs: string, status: string): Promise<void>;
  clearStatus(threadTs: string): Promise<void>;
  resolveBotUserId(): Promise<string | undefined>;
}

export type TransportFactory = (
  config: SlackBridgeConfig,
  onInbound: InboundHandler,
) => SlackTransport;

const defaultTransportFactory: TransportFactory = (config, onInbound) =>
  new SlackGateway(config, onInbound);

const ENTRY_TYPE = "slack-bridge-thread";

interface ThreadState {
  threadTs: string;
}

interface MessageLike {
  role?: string;
  content?: unknown;
}

function extractText(message: unknown): string {
  const msg = message as MessageLike;
  const content = msg?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => (block as { type?: string })?.type === "text")
    .map((block) => String((block as { text?: unknown }).text ?? ""))
    .join("")
    .trim();
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}\u2026` : clean;
}

function summarizeTool(toolName: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case "bash":
      return `bash: ${truncate(String(a.command ?? ""), 80)}`;
    case "read":
      return `read: ${truncate(String(a.path ?? ""), 80)}`;
    case "write":
      return `write: ${truncate(String(a.path ?? ""), 80)}`;
    case "edit":
      return `edit: ${truncate(String(a.path ?? ""), 80)}`;
    case "grep":
    case "ffgrep":
      return `grep: ${truncate(String(a.pattern ?? ""), 60)}`;
    case "find":
    case "fffind":
      return `find: ${truncate(String(a.pattern ?? a.path ?? ""), 60)}`;
    default: {
      const hint = a.path ?? a.command ?? a.pattern ?? a.query ?? a.url;
      return hint ? `${toolName}: ${truncate(String(hint), 60)}` : toolName;
    }
  }
}

export class SlackBridge {
  private readonly pi: ExtensionAPI;
  private readonly config: SlackBridgeConfig;
  private readonly transportFactory: TransportFactory;
  private gateway: SlackTransport | undefined;
  private threadTs: string | undefined;
  private botUserId: string | undefined;
  private rootPromise: Promise<void> | undefined;
  private readonly injected = new Set<string>();
  private getContext: (() => ExtensionContext | undefined) | undefined;
  private statusPromise: Promise<void> = Promise.resolve();
  private turnActive = false;

  constructor(
    pi: ExtensionAPI,
    config: SlackBridgeConfig,
    transportFactory: TransportFactory = defaultTransportFactory,
  ) {
    this.pi = pi;
    this.config = config;
    this.transportFactory = transportFactory;
  }

  bindContext(getContext: () => ExtensionContext | undefined): void {
    this.getContext = getContext;
  }

  restoreFromEntries(ctx: ExtensionContext): void {
    const entries = ctx.sessionManager.getEntries?.() ?? [];
    for (const entry of entries) {
      const e = entry as { type?: string; customType?: string; data?: ThreadState };
      if (e.type === "custom" && e.customType === ENTRY_TYPE && e.data?.threadTs) {
        this.threadTs = e.data.threadTs;
      }
    }
  }

  async start(): Promise<void> {
    this.gateway = this.transportFactory(this.config, (message) => this.handleInbound(message));
    this.botUserId = await this.gateway.resolveBotUserId();
    await this.gateway.start();
  }

  async stop(): Promise<void> {
    await this.gateway?.stop();
    this.gateway = undefined;
  }

  private async ensureThread(seedText: string): Promise<string | undefined> {
    if (this.threadTs) return this.threadTs;
    if (!this.gateway) return undefined;
    if (!this.rootPromise) {
      const header = seedText
        ? `:robot_face: Pi session\n> ${seedText.slice(0, 200)}`
        : ":robot_face: Pi session";
      this.rootPromise = this.gateway.postRoot(header).then((ts) => {
        if (ts) {
          this.threadTs = ts;
          this.pi.appendEntry<ThreadState>(ENTRY_TYPE, { threadTs: ts });
        }
      });
    }
    await this.rootPromise;
    return this.threadTs;
  }

  async mirrorUserInput(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (this.consumeInjected(trimmed)) return;
    const existed = this.threadTs !== undefined;
    const thread = await this.ensureThread(trimmed);
    if (!thread || !this.gateway) return;
    if (!existed) return;
    await this.gateway.postToThread(thread, `:bust_in_silhouette: *terminal*\n${trimmed}`);
  }

  async beginTurn(): Promise<void> {
    const thread = await this.ensureThread("");
    if (!thread) return;
    this.turnActive = true;
    this.pushStatus(":hourglass_flowing_sand: pensando\u2026");
  }

  async recordTool(toolName: string, args: unknown): Promise<void> {
    if (!this.threadTs) return;
    this.pushStatus(summarizeTool(toolName, args));
  }

  async recordToolError(toolName: string): Promise<void> {
    if (!this.threadTs) return;
    this.pushStatus(`erro em ${toolName}`);
  }

  async finishTurn(message: unknown): Promise<void> {
    this.turnActive = false;
    const text = extractText(message);
    const thread = await this.ensureThread(text);
    if (!thread || !this.gateway) return;
    const gateway = this.gateway;
    const body = text || ":white_check_mark: conclu\u00eddo";
    this.enqueueStatus(async () => {
      await gateway.postToThread(thread, body);
      await gateway.clearStatus(thread);
    });
    await this.statusPromise;
  }

  private pushStatus(status: string): void {
    const thread = this.threadTs;
    if (!thread || !this.gateway || !this.turnActive) return;
    const gateway = this.gateway;
    this.enqueueStatus(() => gateway.setStatus(thread, status));
  }

  private enqueueStatus(work: () => Promise<void>): void {
    this.statusPromise = this.statusPromise.then(work).catch(() => {});
  }

  private markInjected(text: string): void {
    this.injected.add(text.trim());
  }

  private consumeInjected(text: string): boolean {
    const key = text.trim();
    if (this.injected.has(key)) {
      this.injected.delete(key);
      return true;
    }
    return false;
  }

  private async handleInbound(message: InboundMessage): Promise<void> {
    if (message.channel !== this.config.channel) return;
    if (message.botId) return;
    if (this.botUserId && message.userId === this.botUserId) return;
    const isDirectMessage = message.channel.startsWith("D");
    if (!isDirectMessage && this.config.allowedUserIds.size > 0 && !this.config.allowedUserIds.has(message.userId)) return;

    const text = message.text.trim();
    if (!text) return;

    if (this.threadTs) {
      if (message.threadTs !== this.threadTs) return;
    } else {
      this.adoptThread(message.threadTs ?? message.ts);
    }

    const ctx = this.getContext?.();
    this.markInjected(text);

    if (!ctx || ctx.isIdle()) {
      this.pi.sendUserMessage(text);
    } else {
      this.pi.sendUserMessage(text, { deliverAs: "steer" });
    }
  }

  private adoptThread(ts: string): void {
    this.threadTs = ts;
    this.pi.appendEntry<ThreadState>(ENTRY_TYPE, { threadTs: ts });
  }
}
