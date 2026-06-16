import { createHash } from "node:crypto";

interface Message {
  role: string;
  content: any;
  toolCallId?: string;
  [key: string]: any;
}

export function deltaCompress(
  msg: Message,
  hashStore: Map<string, string>
): Message | null {
  const text = extractToolText(msg);
  if (!text || text.length < 200) return null;

  if (!msg.toolCallId) return null;
  const id = msg.toolCallId;
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);

  const previousHash = hashStore.get(`${id}:hash`);

  if (previousHash === hash) {
    const stub = `[unchanged from previous call — ${text.length} chars]`;
    return replaceContent(msg, stub);
  }

  if (previousHash) {
    const previousText = hashStore.get(`${id}:text`) ?? "";
    const diff = computeLineDiff(previousText, text);
    if (diff && diff.length < text.length * 0.5) {
      hashStore.set(`${id}:hash`, hash);
      hashStore.set(`${id}:text`, text);
      return replaceContent(msg, `[delta from previous]\n${diff}`);
    }
  }

  hashStore.set(`${id}:hash`, hash);
  hashStore.set(`${id}:text`, text);
  return null;
}

function extractToolText(msg: Message): string | null {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    const textBlock = msg.content.find((c: any) => c.type === "text" && c.text);
    return textBlock?.text ?? null;
  }
  return null;
}

function replaceContent(msg: Message, text: string): Message {
  if (typeof msg.content === "string") {
    return { ...msg, content: text };
  }
  return {
    ...msg,
    content: msg.content.map((c: any) =>
      c.type === "text" ? { ...c, text } : c
    ),
  };
}

function computeLineDiff(previous: string, current: string): string | null {
  if (!previous) return null;

  const prevLines = previous.split("\n");
  const currLines = current.split("\n");

  const added: string[] = [];
  const removed: string[] = [];

  const prevSet = new Set(prevLines);
  const currSet = new Set(currLines);

  for (const line of currLines) {
    if (!prevSet.has(line) && line.trim()) added.push(`+ ${line}`);
  }
  for (const line of prevLines) {
    if (!currSet.has(line) && line.trim()) removed.push(`- ${line}`);
  }

  if (added.length === 0 && removed.length === 0) return null;
  if (added.length + removed.length > currLines.length * 0.7) return null;

  return [...removed.slice(0, 10), ...added.slice(0, 10)].join("\n");
}
