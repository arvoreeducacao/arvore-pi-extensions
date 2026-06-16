import type { CompressorStats } from "./types.js";
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

export function createCompressor() {
  const state = {
    turnsProcessed: 0,
    totalInputChars: 0,
    totalOutputChars: 0,
    previousToolHashes: new Map<string, string>(),
  };

  function compress(messages: Message[]): Message[] {
    state.turnsProcessed++;
    if (messages.length < 4) return messages;

    const lastUserIdx = findLastUserMessage(messages);
    if (lastUserIdx === -1) return messages;

    const query = extractText(messages[lastUserIdx]);
    const recentBoundary = Math.max(0, messages.length - 6);

    const result: Message[] = [];
    const scored = scoreMessages(messages, query, recentBoundary);

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const score = scored.get(i);

      if (i >= recentBoundary) {
        result.push(msg);
        continue;
      }

      if (msg.role === "assistant" || msg.role === "user") {
        if (score !== undefined && score < 0.15) {
          const compressed = summarizeMessage(msg);
          if (compressed) {
            result.push(compressed);
            continue;
          }
        }
        result.push(msg);
        continue;
      }

      if (isToolResult(msg)) {
        const delta = deltaCompress(msg, state.previousToolHashes);
        if (delta) {
          result.push(delta);
          continue;
        }
        result.push(compressToolMessage(msg));
        continue;
      }

      result.push(msg);
    }

    trackStats(messages, result);
    return result;
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
    return {
      turnsProcessed: state.turnsProcessed,
      totalSaved: state.totalInputChars - state.totalOutputChars,
      ratio,
    };
  }

  function scoreMessages(
    messages: Message[],
    query: string,
    recentBoundary: number
  ): Map<number, number> {
    const scorable: ScoredMessage[] = [];
    const indices: number[] = [];

    for (let i = 0; i < recentBoundary; i++) {
      const text = extractText(messages[i]);
      if (text.length > 20) {
        scorable.push({ text, index: i });
        indices.push(i);
      }
    }

    return bm25Score(scorable, query);
  }

  function compressToolMessage(msg: Message): Message {
    if (!msg.content || !Array.isArray(msg.content)) return msg;

    const newContent = msg.content.map((block: any) => {
      if (block.type !== "text" || !block.text || block.text.length < 300) return block;
      let text = block.text;
      text = foldLogs(text);
      text = deduplicateLines(text);
      text = compactJson(text);
      return { ...block, text };
    });

    return { ...msg, content: newContent };
  }

  function trackStats(input: Message[], output: Message[]) {
    const inputChars = input.reduce((sum, m) => sum + messageSize(m), 0);
    const outputChars = output.reduce((sum, m) => sum + messageSize(m), 0);
    state.totalInputChars += inputChars;
    state.totalOutputChars += outputChars;
  }

  return { compress, compressToolResult, getStats };
}

function findLastUserMessage(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return -1;
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

function summarizeMessage(msg: Message): Message | null {
  const text = extractText(msg);
  if (text.length < 200) return null;

  const truncated = text.slice(0, 150) + `\n[... ${text.length - 150} chars compressed ...]`;
  if (typeof msg.content === "string") {
    return { ...msg, content: truncated };
  }
  return {
    ...msg,
    content: [{ type: "text", text: truncated }],
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
  const text = extractText(msg);
  return text.length;
}
