type ContentBlock = {
  type: string;
  text?: string;
  toolName?: string;
  content?: Array<{ type: string; text?: string }>;
};

type SessionEntry = {
  type: string;
  message?: {
    role: string;
    content?: string | ContentBlock[];
  };
};

const MAX_BLOCK_CHARS = 600;
const MAX_TRANSCRIPT_CHARS = 12000;

function blocksToText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content.trim();
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && block.text) {
      parts.push(block.text.trim());
    } else if (block.type === "toolCall") {
      const name = block.toolName || "tool";
      parts.push(`[called ${name}]`);
    } else if (block.type === "thinking") {
      continue;
    }
  }
  return parts.join(" ").trim();
}

function toolResultToText(content: string | ContentBlock[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content.trim();
  return content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!.trim())
    .join(" ")
    .trim();
}

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function countUserTurns(rawEntries: unknown[]): number {
  const entries = rawEntries as SessionEntry[];
  let turns = 0;
  for (const entry of entries) {
    if (entry.type === "message" && entry.message?.role === "user") turns++;
  }
  return turns;
}

export function buildTranscript(rawEntries: unknown[]): string {
  const entries = rawEntries as SessionEntry[];
  const lines: string[] = [];

  for (const entry of entries) {
    if (entry.type !== "message" || !entry.message) continue;
    const { role, content } = entry.message;

    if (role === "user") {
      const text = blocksToText(content ?? "");
      if (text) lines.push(`USER: ${clamp(text, MAX_BLOCK_CHARS)}`);
    } else if (role === "assistant") {
      const text = blocksToText(content ?? "");
      if (text) lines.push(`ASSISTANT: ${clamp(text, MAX_BLOCK_CHARS)}`);
    } else if (role === "toolResult") {
      const text = toolResultToText(content as ContentBlock[] | undefined);
      if (text) lines.push(`RESULT: ${clamp(text, 200)}`);
    }
  }

  const joined = lines.join("\n");
  if (joined.length <= MAX_TRANSCRIPT_CHARS) return joined;
  return `…\n${joined.slice(joined.length - MAX_TRANSCRIPT_CHARS)}`;
}
