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

const PROTECTED_TURNS = 4;
const MIN_SAVINGS_RATIO = 0.15;
const SUMMARIZE_MIN_CHARS = 400;
const BM25_DROP_THRESHOLD = 0.25;

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

    const cacheActive = detectActiveCache(ctx);
    const query = extractText(messages[lastUserIdx]);
    const protectedBoundary = findProtectedBoundary(messages, PROTECTED_TURNS);

    const scored = scoreMessages(messages, query, protectedBoundary);
    const result: Message[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (i >= protectedBoundary) {
        result.push(msg);
        continue;
      }

      if (isToolResult(msg)) {
        if (!cacheActive) {
          const delta = deltaCompress(msg, state.previousToolHashes);
          if (delta) {
            result.push(delta);
            continue;
          }
        }
        result.push(compressToolMessage(msg));
        continue;
      }

      if (msg.role === "assistant" || msg.role === "user") {
        if (cacheActive) {
          result.push(msg);
          continue;
        }
        const compressed = await maybeCompressMessage(msg, scored.get(i), ctx);
        result.push(compressed ?? msg);
        continue;
      }

      result.push(msg);
    }

    trackStats(messages, result);
    return result;
  }

  async function maybeCompressMessage(
    msg: Message,
    score: number | undefined,
    ctx: any
  ): Promise<Message | null> {
    const text = extractText(msg);
    if (text.length < SUMMARIZE_MIN_CHARS) return null;

    const stableKey = store.makeId(text);
    const cachedForm = state.stableCompressions.get(stableKey);
    if (cachedForm !== undefined) {
      return replaceText(msg, cachedForm);
    }

    const relevant = score !== undefined && score >= BM25_DROP_THRESHOLD;

    let replacement: string | null = null;

    if (relevant) {
      const summary = await summarizer.summarize(text, ctx);
      if (summary && summary.length < text.length * (1 - MIN_SAVINGS_RATIO)) {
        const id = store.put(text, msg.role, state.turnsProcessed);
        replacement = `${summary}\n[full original: recover_context("${id}")]`;
      }
    } else {
      const summary = await summarizer.summarize(text, ctx);
      const id = store.put(text, msg.role, state.turnsProcessed);
      if (summary && summary.length < text.length * (1 - MIN_SAVINGS_RATIO)) {
        replacement = `[low-relevance, summarized] ${summary}\n[full: recover_context("${id}")]`;
      } else {
        replacement = `[compressed ${msg.role} message — ${text.length} chars — recover_context("${id}")]`;
      }
    }

    if (replacement === null || replacement.length >= text.length) return null;

    state.stableCompressions.set(stableKey, replacement);
    return replaceText(msg, replacement);
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
      if (text.length > 20) {
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
