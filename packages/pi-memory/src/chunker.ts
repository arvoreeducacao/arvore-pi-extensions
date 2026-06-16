import { randomUUID } from "node:crypto";

export interface Chunk {
  id: string;
  content: string;
  turnIndex: number;
}

interface Message {
  role: "user" | "assistant" | "system";
  content: string | Array<{ type: string; text?: string }>;
}

function extractText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text" && !!c.text)
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

const MAX_CHUNK_TOKENS = 1000;
const APPROX_CHARS_PER_TOKEN = 4;
const MAX_CHUNK_CHARS = MAX_CHUNK_TOKENS * APPROX_CHARS_PER_TOKEN;

function splitLongText(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length > MAX_CHUNK_CHARS && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += para + "\n\n";
  }

  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

export function chunkSession(messages: Message[]): Chunk[] {
  const chunks: Chunk[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "system") continue;

    const text = extractText(msg);
    if (text.length < 30) continue;

    const prefix = msg.role === "user" ? "User: " : "Assistant: ";
    const parts = splitLongText(text);

    for (const part of parts) {
      chunks.push({
        id: randomUUID(),
        content: `${prefix}${part}`,
        turnIndex: i,
      });
    }
  }

  return chunks;
}
