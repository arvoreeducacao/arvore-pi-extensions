import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TITLE = "Pi";
const MAX_BODY_LEN = 100;

function notify(body: string): void {
  const truncated = body.length > MAX_BODY_LEN ? `${body.slice(0, MAX_BODY_LEN)}…` : body;
  const script = `display notification "${truncated.replace(/"/g, '\\"')}" with title "${TITLE}" sound name "Glass"`;
  execFile("osascript", ["-e", script], () => {});
}

function extractText(messages: Array<{ role?: string; content?: Array<{ type: string; text?: string }> }>): string {
  const last = [...messages].reverse().find((m) => m.role === "assistant");
  if (!last?.content) return "Done";
  const text = last.content
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text!)
    .join(" ")
    .trim();
  return text || "Done";
}

export default function turnNotificationExtension(api: ExtensionAPI): void {
  api.on("agent_end", async (event) => {
    notify(extractText(event.messages as any));
  });
}
