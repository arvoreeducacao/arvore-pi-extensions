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

export interface BlockAction {
  actionId: string;
  value: string;
  userId: string;
  channel: string;
  messageTs: string;
  threadTs?: string;
}

export type InboundHandler = (message: InboundMessage) => void | Promise<void>;
export type ActionHandler = (action: BlockAction) => void | Promise<void>;

export class SlackGateway {
  private readonly web: WebClient;
  private readonly socket: SocketModeClient;
  private readonly config: SlackBridgeConfig;
  private started = false;

  constructor(config: SlackBridgeConfig, onInbound: InboundHandler, onAction?: ActionHandler) {
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

    this.socket.on("interactive", async ({ body, ack }: { body: Record<string, unknown>; ack: () => Promise<void> }) => {
      await ack();
      if (!onAction) return;
      if (body?.type !== "block_actions") return;
      const actions = Array.isArray(body.actions) ? body.actions : [];
      const first = actions[0] as Record<string, unknown> | undefined;
      if (!first) return;
      const user = body.user as Record<string, unknown> | undefined;
      const channelObj = body.channel as Record<string, unknown> | undefined;
      const messageObj = body.message as Record<string, unknown> | undefined;
      const actionId = typeof first.action_id === "string" ? first.action_id : "";
      const value = typeof first.value === "string" ? first.value : "";
      const userId = typeof user?.id === "string" ? user.id : "";
      const channel = typeof channelObj?.id === "string" ? channelObj.id : "";
      const messageTs = typeof messageObj?.ts === "string" ? messageObj.ts : "";
      const threadTs = typeof messageObj?.thread_ts === "string" ? messageObj.thread_ts : undefined;
      if (!actionId || !channel || !messageTs) return;
      await onAction({ actionId, value, userId, channel, messageTs, threadTs });
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
    const res = await this.web.chat.postMessage({ channel: this.config.channel, text, mrkdwn: true });
    return typeof res.ts === "string" ? res.ts : undefined;
  }

  async postToThread(threadTs: string, text: string): Promise<string | undefined> {
    const res = await this.web.chat.postMessage({
      channel: this.config.channel,
      thread_ts: threadTs,
      text,
      mrkdwn: true,
    });
    return typeof res.ts === "string" ? res.ts : undefined;
  }

  async postBlocks(threadTs: string, text: string, blocks: unknown[]): Promise<string | undefined> {
    const res = await this.web.chat.postMessage({
      channel: this.config.channel,
      thread_ts: threadTs,
      text,
      blocks: blocks as never,
    });
    return typeof res.ts === "string" ? res.ts : undefined;
  }

  async updateBlocks(ts: string, text: string, blocks: unknown[]): Promise<void> {
    await this.web.chat.update({
      channel: this.config.channel,
      ts,
      text,
      blocks: blocks as never,
    });
  }

  async updateText(ts: string, text: string): Promise<void> {
    await this.web.chat.update({ channel: this.config.channel, ts, text });
  }

  async uploadImage(threadTs: string, png: Buffer, title: string, comment?: string): Promise<void> {
    await this.web.files.uploadV2({
      channel_id: this.config.channel,
      thread_ts: threadTs,
      file: png,
      filename: `${title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "diff"}.png`,
      title,
      initial_comment: comment,
    });
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
