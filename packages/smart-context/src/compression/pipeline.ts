import type { CompressorStats } from "./types.js";
import type { ContentStore } from "./store.js";
import type { Summarizer } from "./haiku-summarize.js";
import { deduplicateLines } from "./stages/dedup.js";
import { foldLogs } from "./stages/log-fold.js";
import { compactJson } from "./stages/json-compact.js";
import { bm25Score, type ScoredMessage } from "./stages/bm25.js";
import { deltaCompress } from "./stages/delta.js";

interface Message {
  role: string;
  content: any;
  toolCallId?: string;
  [key: string]: any;
}

interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: any;
}

interface AggressionProfile {
  protectedTurns: number;
  minSavingsRatio: number;
  summarizeMinChars: number;
  bm25DropThreshold: number;
  largeToolOutputChars: number;
  toolStubHeadChars: number;
  compressDespiteCache: boolean;
}

const BALANCED_PROFILE: AggressionProfile = {
  protectedTurns: 4,
  minSavingsRatio: 0.15,
  summarizeMinChars: 400,
  bm25DropThreshold: 0.25,
  largeToolOutputChars: 4000,
  toolStubHeadChars: 600,
  compressDespiteCache: false,
};

const AGGRESSIVE_PROFILE: AggressionProfile = {
  protectedTurns: 2,
  minSavingsRatio: 0.1,
  summarizeMinChars: 250,
  bm25DropThreshold: 0.35,
  largeToolOutputChars: 2000,
  toolStubHeadChars: 400,
  compressDespiteCache: true,
};

const SMALL_CONTEXT_WINDOW = 200_000;
const HIGH_USAGE_RATIO = 0.6;

function resolveProfile(ctx: any): AggressionProfile {
  const model = ctx.getModel?.();
  const contextWindow: number | undefined = model?.contextWindow;
  const usage = ctx.getContextUsage?.();
  const usedTokens: number | undefined = usage?.tokens;

  const smallWindow =
    typeof contextWindow === "number" && contextWindow > 0 && contextWindow < SMALL_CONTEXT_WINDOW;

  const highUsage =
    typeof usedTokens === "number" &&
    typeof contextWindow === "number" &&
    contextWindow > 0 &&
    usedTokens / contextWindow >= HIGH_USAGE_RATIO;

  return smallWindow || highUsage ? AGGRESSIVE_PROFILE : BALANCED_PROFILE;
}

interface CompressorDeps {
  store: ContentStore;
  summarizer: Summarizer;
}

export function createCompressor(deps: CompressorDeps) {
  const { store, summarizer } = deps;

  const state = {
    turnsProcessed: 0,
    totalInputChars: 0,
    totalOutputChars: 0,
    previousToolHashes: new Map<string, string>(),
    stableCompressions: new Map<string, string>(),
  };

  async function compress(messages: Message[], ctx: any): Promise<Message[]> {
    state.turnsProcessed++;
    if (messages.length < 4) return messages;

    const lastUserIdx = findLastUserMessage(messages);
    if (lastUserIdx === -1) return messages;

    const profile = resolveProfile(ctx);
    const cacheActive = detectActiveCache(ctx);
    const query = extractText(messages[lastUserIdx]);
    const protectedBoundary = findProtectedBoundary(messages, profile.protectedTurns);

    const scored = scoreMessages(messages, query, protectedBoundary);
    const result: (Message | null)[] = new Array(messages.length).fill(null);
    const summarizeQueue: Array<{ index: number; msg: Message; score: number | undefined }> = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (i >= protectedBoundary) {
        result[i] = msg;
        continue;
      }

      if (isToolResult(msg)) {
        if (!cacheActive || profile.compressDespiteCache) {
          const delta = deltaCompress(msg, state.previousToolHashes);
          if (delta) {
            result[i] = delta;
            continue;
          }
          const trimmed = maybeTrimLargeToolOutput(msg, profile);
          if (trimmed) {
            result[i] = trimmed;
            continue;
          }
        }
        result[i] = compressToolMessage(msg);
        continue;
      }

      if (msg.role === "assistant" || msg.role === "user") {
        if (cacheActive && !profile.compressDespiteCache) {
          result[i] = msg;
          continue;
        }
        const stableKey = store.makeId(extractText(msg));
        const cachedForm = state.stableCompressions.get(stableKey);
        if (cachedForm !== undefined) {
          result[i] = replaceText(msg, cachedForm);
          continue;
        }
        if (extractText(msg).length >= profile.summarizeMinChars) {
          summarizeQueue.push({ index: i, msg, score: scored.get(i) });
        } else {
          result[i] = msg;
        }
        continue;
      }

      result[i] = msg;
    }

    if (summarizeQueue.length > 0) {
      const compressed = await Promise.all(
        summarizeQueue.map(({ msg, score }) => maybeCompressMessage(msg, score, ctx, profile)),
      );
      for (let j = 0; j < summarizeQueue.length; j++) {
        result[summarizeQueue[j].index] = compressed[j] ?? summarizeQueue[j].msg;
      }
    }

    const finalResult = result.filter((m): m is Message => m !== null);
    trackStats(messages, finalResult);
    return finalResult;
  }

  async function maybeCompressMessage(
    msg: Message,
    score: number | undefined,
    ctx: any,
    profile: AggressionProfile
  ): Promise<Message | null> {
    const text = extractText(msg);
    if (text.length < profile.summarizeMinChars) return null;

    const stableKey = store.makeId(text);
    const cachedForm = state.stableCompressions.get(stableKey);
    if (cachedForm !== undefined) {
      return replaceText(msg, cachedForm);
    }

    const relevant = score !== undefined && score >= profile.bm25DropThreshold;

    let replacement: string | null = null;

    if (relevant) {
      const summary = await summarizer.summarize(text, ctx);
      if (summary && summary.length < text.length * (1 - profile.minSavingsRatio)) {
        const id = store.put(text, msg.role, state.turnsProcessed);
        replacement = `${summary}\n[full original: recover_context("${id}")]`;
      }
    } else {
      const summary = await summarizer.summarize(text, ctx);
      const id = store.put(text, msg.role, state.turnsProcessed);
      if (summary && summary.length < text.length * (1 - profile.minSavingsRatio)) {
        replacement = `[low-relevance, summarized] ${summary}\n[full: recover_context("${id}")]`;
      } else {
        replacement = `[compressed ${msg.role} message — ${text.length} chars — recover_context("${id}")]`;
      }
    }

    if (replacement === null || replacement.length >= text.length) return null;

    state.stableCompressions.set(stableKey, replacement);
    return replaceText(msg, replacement);
  }

  function maybeTrimLargeToolOutput(msg: Message, profile: AggressionProfile): Message | null {
    const text = extractText(msg);
    if (text.length < profile.largeToolOutputChars) return null;

    const stableKey = store.makeId(text);
    const cachedForm = state.stableCompressions.get(stableKey);
    if (cachedForm !== undefined) {
      return replaceText(msg, cachedForm);
    }

    let structural = text;
    structural = foldLogs(structural);
    structural = deduplicateLines(structural);
    structural = compactJson(structural);
    if (structural.length < text.length * (1 - profile.minSavingsRatio)) {
      state.stableCompressions.set(stableKey, structural);
      return replaceText(msg, structural);
    }

    const id = store.put(text, msg.role, state.turnsProcessed);
    const head = text.slice(0, profile.toolStubHeadChars);
    const stub = `${head}\n[... ${text.length - profile.toolStubHeadChars} chars trimmed — recover_context("${id}") for full output ...]`;

    if (stub.length >= text.length) return null;

    state.stableCompressions.set(stableKey, stub);
    return replaceText(msg, stub);
  }

  function compressToolResult(
    toolName: string,
    content: ContentBlock[]
  ): ContentBlock[] | undefined {
    const textBlock = content.find((c) => c.type === "text" && c.text);
    if (!textBlock || !textBlock.text || textBlock.text.length < 500) return undefined;

    let text = textBlock.text;
    const originalLen = text.length;

    text = foldLogs(text);
    text = deduplicateLines(text);
    text = compactJson(text);

    if (toolName === "read") {
      text = trimLargeFileOutput(text);
    }

    if (text.length >= originalLen) return undefined;

    return content.map((c) => {
      if (c.type === "text" && c.text === textBlock.text) {
        return { ...c, text };
      }
      return c;
    });
  }

  function getStats(): CompressorStats {
    const ratio =
      state.totalInputChars > 0
        ? Math.round((1 - state.totalOutputChars / state.totalInputChars) * 100)
        : 0;
    const haiku = summarizer.getStats();
    return {
      turnsProcessed: state.turnsProcessed,
      totalSaved: state.totalInputChars - state.totalOutputChars,
      ratio,
      haikuCalls: haiku.calls,
      haikuCacheHits: haiku.cacheHits,
      storedItems: store.size(),
    };
  }

  function scoreMessages(
    messages: Message[],
    query: string,
    boundary: number
  ): Map<number, number> {
    const scorable: ScoredMessage[] = [];
    for (let i = 0; i < boundary; i++) {
      const text = extractText(messages[i]);
      if (text.length > 20 && !state.stableCompressions.has(store.makeId(text))) {
        scorable.push({ text, index: i });
      }
    }
    return bm25Score(scorable, query);
  }

  function compressToolMessage(msg: Message): Message {
    if (!msg.content || !Array.isArray(msg.content)) return msg;

    const newContent = msg.content.map((block: any) => {
      if (block.type !== "text" || !block.text || block.text.length < 300) return block;
      const original = block.text;
      let text = original;
      text = foldLogs(text);
      text = deduplicateLines(text);
      text = compactJson(text);
      return text.length < original.length ? { ...block, text } : block;
    });

    return { ...msg, content: newContent };
  }

  function trackStats(input: Message[], output: Message[]) {
    state.totalInputChars += input.reduce((s, m) => s + messageSize(m), 0);
    state.totalOutputChars += output.reduce((s, m) => s + messageSize(m), 0);
  }

  return { compress, compressToolResult, getStats };
}

function findLastUserMessage(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return -1;
}

function detectActiveCache(ctx: any): boolean {
  const entries = ctx.sessionManager?.getEntries?.();
  if (!entries) return false;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const usage = entry?.message?.usage;
    if (!usage) continue;
    if (entry.message?.role !== "assistant") continue;
    return (usage.cacheRead ?? 0) > 0 || (usage.cacheWrite ?? 0) > 0;
  }
  return false;
}

function findProtectedBoundary(messages: Message[], turns: number): number {
  let userCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userCount++;
      if (userCount === turns) return i;
    }
  }
  return 0;
}

function extractText(msg: Message): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join(" ");
  }
  return "";
}

function isToolResult(msg: Message): boolean {
  return msg.role === "toolResult" || msg.role === "tool";
}

function replaceText(msg: Message, text: string): Message {
  if (typeof msg.content === "string") {
    return { ...msg, content: text };
  }
  return {
    ...msg,
    content: [{ type: "text", text }],
  };
}

function trimLargeFileOutput(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= 100) return text;
  const head = lines.slice(0, 40);
  const tail = lines.slice(-40);
  const omitted = lines.length - 80;
  return [...head, `\n[... ${omitted} lines omitted ...]`, ...tail].join("\n");
}

function messageSize(msg: Message): number {
  return extractText(msg).length;
}
