import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import type { SlackBridgeConfig } from "./config.js";

export interface InboundMessage {
  text: string;
  userId: string;
  channel: string;
  threadTs?: string;
  ts: string;
  botId?: string;
}

export type InboundHandler = (message: InboundMessage) => void | Promise<void>;

export class SlackGateway {
  private readonly web: WebClient;
  private readonly socket: SocketModeClient;
  private readonly config: SlackBridgeConfig;
  private started = false;

  constructor(config: SlackBridgeConfig, onInbound: InboundHandler) {
    this.config = config;
    this.web = new WebClient(config.botToken);
    this.socket = new SocketModeClient({ appToken: config.appToken });

    this.socket.on("message", async ({ event, ack }: { event: Record<string, unknown>; ack: () => Promise<void> }) => {
      await ack();
      if (!event || event.subtype) return;
      const text = typeof event.text === "string" ? event.text : "";
      const userId = typeof event.user === "string" ? event.user : "";
      const channel = typeof event.channel === "string" ? event.channel : "";
      const ts = typeof event.ts === "string" ? event.ts : "";
      if (!userId || !channel || !ts) return;
      await onInbound({
        text,
        userId,
        channel,
        ts,
        threadTs: typeof event.thread_ts === "string" ? event.thread_ts : undefined,
        botId: typeof event.bot_id === "string" ? event.bot_id : undefined,
      });
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.socket.start();
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    try {
      await this.socket.disconnect();
    } catch {}
  }

  async postRoot(text: string): Promise<string | undefined> {
    const res = await this.web.chat.postMessage({ channel: this.config.channel, text });
    return typeof res.ts === "string" ? res.ts : undefined;
  }

  async postToThread(threadTs: string, text: string): Promise<string | undefined> {
    const res = await this.web.chat.postMessage({
      channel: this.config.channel,
      thread_ts: threadTs,
      text,
    });
    return typeof res.ts === "string" ? res.ts : undefined;
  }

  async setStatus(threadTs: string, status: string): Promise<void> {
    await this.web.apiCall("assistant.threads.setStatus", {
      channel_id: this.config.channel,
      thread_ts: threadTs,
      status,
    });
  }

  async clearStatus(threadTs: string): Promise<void> {
    await this.setStatus(threadTs, "");
  }

  async resolveBotUserId(): Promise<string | undefined> {
    const res = await this.web.auth.test();
    return typeof res.user_id === "string" ? res.user_id : undefined;
  }
}
