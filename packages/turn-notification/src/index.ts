import { execFile } from "node:child_process";
import { platform } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TITLE = "Pi";
const MAX_BODY_LEN = 100;

function notifyMac(body: string): void {
  const script = `display notification "${body.replace(/"/g, '\\"')}" with title "${TITLE}" sound name "Glass"`;
  execFile("osascript", ["-e", script], () => {});
}

function notifyLinux(body: string): void {
  execFile("notify-send", ["--app-name=Pi", TITLE, body], () => {});
  playLinuxSound();
}

const LINUX_SOUNDS: Array<[string, string[]]> = [
  ["canberra-gtk-play", ["--id=message"]],
  ["paplay", ["/usr/share/sounds/freedesktop/stereo/message.oga"]],
];

function playLinuxSound(index = 0): void {
  const candidate = LINUX_SOUNDS[index];
  if (!candidate) return;
  const [cmd, args] = candidate;
  execFile(cmd, args, (error) => {
    if (error) playLinuxSound(index + 1);
  });
}

function notify(body: string): void {
  const truncated = body.length > MAX_BODY_LEN ? `${body.slice(0, MAX_BODY_LEN)}…` : body;
  if (platform() === "darwin") {
    notifyMac(truncated);
    return;
  }
  if (platform() === "linux") {
    notifyLinux(truncated);
    return;
  }
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
