import type { ExtensionAPI, ExtensionContext, CustomEntry } from "@earendil-works/pi-coding-agent";
import type { SlackBridgeConfig } from "./config.js";
import {
  SlackGateway,
  type InboundHandler,
  type InboundMessage,
  type ActionHandler,
  type BlockAction,
} from "./slack.js";
import {
  buildQuestionBlocks,
  consolidateAnswers,
  isQuestionTool,
  parseActionId,
  parseQuestions,
  toSlackMarkdown,
  type NormalizedQuestion,
} from "./format.js";

export interface SlackTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  postRoot(text: string): Promise<string | undefined>;
  postToThread(threadTs: string, text: string): Promise<string | undefined>;
  postBlocks(threadTs: string, text: string, blocks: unknown[]): Promise<string | undefined>;
  updateBlocks(ts: string, text: string, blocks: unknown[]): Promise<void>;
  updateText(ts: string, text: string): Promise<void>;
  setStatus(threadTs: string, status: string): Promise<void>;
  clearStatus(threadTs: string): Promise<void>;
  resolveBotUserId(): Promise<string | undefined>;
}

export type TransportFactory = (
  config: SlackBridgeConfig,
  onInbound: InboundHandler,
  onAction: ActionHandler,
) => SlackTransport;

const defaultTransportFactory: TransportFactory = (config, onInbound, onAction) =>
  new SlackGateway(config, onInbound, onAction);

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

const TOOL_HINT_FIELDS = ["command", "path", "pattern", "query", "url", "content", "prompt", "objective"] as const;

function summarizeTool(toolName: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  for (const field of TOOL_HINT_FIELDS) {
    const value = a[field];
    if (typeof value === "string" && value) {
      return `\`${toolName}\` ${truncate(value, 120)}`;
    }
  }
  return `\`${toolName}\``;
}

function summarizeResult(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return truncate(result, 160);
  const r = result as Record<string, unknown>;
  const candidate = r.output ?? r.content ?? r.text ?? r.message ?? r.stdout;
  if (typeof candidate === "string") return truncate(candidate, 160);
  if (Array.isArray(candidate)) {
    const joined = candidate
      .map((block) => {
        if (typeof block === "string") return block;
        const b = block as { text?: unknown };
        return typeof b?.text === "string" ? b.text : "";
      })
      .join(" ");
    if (joined.trim()) return truncate(joined, 160);
  }
  try {
    return truncate(JSON.stringify(result), 160);
  } catch {
    return "";
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
  private getContext: (() => ExtensionContext | undefined) | undefined;
  private statusPromise: Promise<void> = Promise.resolve();
  private turnActive = false;
  private pendingQuestions: NormalizedQuestion[] | undefined;
  private questionAnswers = new Map<number, string>();
  private questionMessageTs: string | undefined;
  private readonly toolMessages = new Map<string, { ts: string; summary: string }>();

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
      if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
        const data = (entry as CustomEntry<ThreadState>).data;
        if (data?.threadTs) this.threadTs = data.threadTs;
      }
    }
  }

  async start(): Promise<void> {
    this.gateway = this.transportFactory(
      this.config,
      (message) => this.handleInbound(message),
      (action) => this.handleAction(action),
    );
    this.botUserId = await this.gateway.resolveBotUserId();
    await this.gateway.start();
  }

  async stop(): Promise<void> {
    await this.gateway?.stop();
    this.gateway = undefined;
  }

  private async ensureThread(seedText?: string): Promise<string | undefined> {
    if (this.threadTs) return this.threadTs;
    if (!this.gateway) return undefined;
    if (!this.rootPromise) {
      const header = seedText
        ? `*Pi session*\n> ${seedText.slice(0, 200)}`
        : "*Pi session*";
      this.rootPromise = this.gateway.postRoot(header).then((ts) => {
        if (ts) this.adoptThread(ts);
      });
    }
    try {
      await this.rootPromise;
    } finally {
      if (!this.threadTs) this.rootPromise = undefined;
    }
    return this.threadTs;
  }

  async mirrorUserInput(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    const existed = this.threadTs !== undefined;
    const thread = await this.ensureThread(trimmed);
    if (!thread || !this.gateway || !existed) return;
    await this.gateway.postToThread(thread, `*terminal*\n${toSlackMarkdown(trimmed)}`);
  }

  async beginTurn(): Promise<void> {
    const thread = await this.ensureThread();
    if (!thread) return;
    this.turnActive = true;
    this.pushStatus("pensando\u2026");
  }

  async recordTool(toolCallId: string, toolName: string, args: unknown): Promise<void> {
    if (!this.threadTs || !this.gateway) return;
    if (isQuestionTool(toolName)) {
      await this.postQuestions(args);
      return;
    }
    const summary = summarizeTool(toolName, args);
    this.pushStatus(summary);
    const thread = this.threadTs;
    const gateway = this.gateway;
    this.enqueueStatus(async () => {
      const ts = await gateway.postToThread(thread, summary);
      if (ts) this.toolMessages.set(toolCallId, { ts, summary });
    });
  }

  async recordToolResult(toolCallId: string, result: unknown, isError: boolean): Promise<void> {
    const entry = this.toolMessages.get(toolCallId);
    if (!entry || !this.gateway) return;
    this.toolMessages.delete(toolCallId);
    const gateway = this.gateway;
    const preview = summarizeResult(result);
    const status = isError ? "erro" : "ok";
    const body = preview
      ? `${entry.summary}\n> ${status}: ${preview}`
      : `${entry.summary}\n> ${status}`;
    this.enqueueStatus(() => gateway.updateText(entry.ts, body));
  }

  private async postQuestions(args: unknown): Promise<void> {
    const questions = parseQuestions(args);
    if (questions.length === 0) return;
    this.pendingQuestions = questions;
    this.questionAnswers = new Map();
    this.questionMessageTs = undefined;
    const thread = this.threadTs;
    const gateway = this.gateway;
    if (!thread || !gateway) return;
    const { text, blocks } = buildQuestionBlocks(questions, this.questionAnswers);
    this.enqueueStatus(async () => {
      const ts = await gateway.postBlocks(thread, text, blocks);
      this.questionMessageTs = ts;
      await gateway.setStatus(thread, "aguardando sua resposta\u2026");
    });
    await this.statusPromise;
  }

  private async handleAction(action: BlockAction): Promise<void> {
    if (action.channel !== this.config.channel) return;
    if (!this.pendingQuestions || !this.gateway) return;
    if (this.questionMessageTs && action.messageTs !== this.questionMessageTs) return;
    const parsed = parseActionId(action.actionId);
    if (!parsed) return;
    const question = this.pendingQuestions[parsed.questionIndex];
    const option = question?.options[parsed.optionIndex];
    if (!option) return;

    this.questionAnswers.set(parsed.questionIndex, option.label);
    const questions = this.pendingQuestions;
    const answers = this.questionAnswers;
    const gateway = this.gateway;
    const messageTs = this.questionMessageTs;
    if (messageTs) {
      const { text, blocks } = buildQuestionBlocks(questions, answers);
      this.enqueueStatus(() => gateway.updateBlocks(messageTs, text, blocks));
    }

    const allAnswered = questions.every((_, i) => answers.has(i));
    if (!allAnswered) return;

    const outgoing = consolidateAnswers(questions, answers);
    this.finalizeQuestions();
    this.dispatch(outgoing);
  }

  private finalizeQuestions(): void {
    this.pendingQuestions = undefined;
    this.questionMessageTs = undefined;
    this.questionAnswers = new Map();
    const thread = this.threadTs;
    if (thread && this.gateway) {
      const gateway = this.gateway;
      this.enqueueStatus(() => gateway.clearStatus(thread));
    }
  }

  private dispatch(text: string): void {
    const ctx = this.getContext?.();
    if (!ctx || ctx.isIdle()) {
      this.pi.sendUserMessage(text);
    } else {
      this.pi.sendUserMessage(text, { deliverAs: "steer" });
    }
  }

  async finishTurn(message: unknown): Promise<void> {
    this.turnActive = false;
    const text = extractText(message);
    const thread = await this.ensureThread(text);
    if (!thread || !this.gateway) return;
    const gateway = this.gateway;
    const body = text ? toSlackMarkdown(text) : "conclu\u00eddo";
    this.enqueueStatus(async () => {
      await gateway.postToThread(thread, body);
      if (!this.pendingQuestions) await gateway.clearStatus(thread);
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

    if (this.pendingQuestions) this.finalizeQuestions();

    this.dispatch(text);
  }

  private adoptThread(ts: string): void {
    this.threadTs = ts;
    this.pi.appendEntry<ThreadState>(ENTRY_TYPE, { threadTs: ts });
  }
}
