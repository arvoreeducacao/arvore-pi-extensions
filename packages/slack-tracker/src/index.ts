import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";

interface SlackLink {
  url: string;
  workspace: string;
  channel: string;
  kind: "message" | "channel";
}

const STATE_DIR = ".pi/slack-tracker-sessions";
const WIDGET_ID = "pi-slack-tracker";
const SLACK_ARCHIVES_RE =
  /https?:\/\/(?:([a-z0-9-]+)\.)?slack\.com\/archives\/([A-Z0-9]+)(?:\/p\d+)?/gi;
const SLACK_CLIENT_RE =
  /https?:\/\/app\.slack\.com\/client\/([A-Z0-9]+)\/([A-Z0-9]+)/gi;

let current: SlackLink | null = null;
let hidden = false;
let widgetVisible = false;
let sessionId = `mem-${Date.now()}`;

function getSessionId(ctx: any): string {
  const file = ctx?.sessionManager?.getSessionFile?.() || "";
  return file ? basename(file, ".json") : sessionId;
}

function findHubRoot(cwd: string): string | null {
  let dir = cwd;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, ".pi")) || existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function getStatePath(cwd: string): string | null {
  const root = findHubRoot(cwd);
  return root ? join(root, STATE_DIR, `${sessionId}.json`) : null;
}

function saveState(cwd: string): void {
  const path = getStatePath(cwd);
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ hidden, current }, null, 2));
  } catch {}
}

function loadState(cwd: string): void {
  const path = getStatePath(cwd);
  if (!path || !existsSync(path)) return;
  try {
    const state = JSON.parse(readFileSync(path, "utf-8")) as {
      hidden?: boolean;
      current?: SlackLink | null;
    };
    hidden = Boolean(state.hidden);
    current = state.current && state.current.url ? state.current : null;
  } catch {}
}

function buildFromArchives(m: RegExpExecArray): SlackLink {
  const isMessage = /\/p\d+/.test(m[0]);
  return {
    url: m[0],
    workspace: m[1] ?? "",
    channel: m[2],
    kind: isMessage ? "message" : "channel",
  };
}

function buildFromClient(m: RegExpExecArray): SlackLink {
  return {
    url: m[0],
    workspace: "",
    channel: m[2],
    kind: "channel",
  };
}

function parseSlackUrl(raw: string): SlackLink | null {
  SLACK_ARCHIVES_RE.lastIndex = 0;
  const a = SLACK_ARCHIVES_RE.exec(raw);
  if (a) return buildFromArchives(a);
  SLACK_CLIENT_RE.lastIndex = 0;
  const c = SLACK_CLIENT_RE.exec(raw);
  if (c) return buildFromClient(c);
  return null;
}

function detectFromText(text: string): SlackLink | null {
  let last: SlackLink | null = null;
  SLACK_ARCHIVES_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SLACK_ARCHIVES_RE.exec(text)) !== null) {
    last = buildFromArchives(m);
  }
  if (last) return last;
  SLACK_CLIENT_RE.lastIndex = 0;
  while ((m = SLACK_CLIENT_RE.exec(text)) !== null) {
    last = buildFromClient(m);
  }
  return last;
}

function resultToText(result: any): string {
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    return result
      .map((r) => (typeof r === "string" ? r : (r?.text ?? "")))
      .join("\n");
  }
  if (result && typeof result === "object") {
    return result.text ?? result.output ?? JSON.stringify(result);
  }
  return "";
}

function renderWidget(width: number, theme: any): string[] {
  if (!current) return [];
  const fg = (color: string, s: string): string =>
    theme?.fg ? theme.fg(color, s) : s;
  const bold = (s: string): string => (theme?.bold ? theme.bold(s) : s);
  const trunc = (s: string, max: number): string =>
    s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;

  const label = current.kind === "message" ? "thread" : "channel";
  const ws = current.workspace ? `${current.workspace} · ` : "";
  const head = bold(fg("text", trunc(`${ws}${label} ${current.channel}`, width - 14)));
  const lines: string[] = [];
  lines.push(`${fg("accent", " ◆ Slack")}  ${head}`);
  lines.push(`   ${fg("mdLinkUrl", trunc(current.url, width - 3))}`);
  return lines;
}

function updateWidget(ctx: any): void {
  if (!ctx?.ui?.setWidget) return;
  if (hidden || !current) {
    if (widgetVisible) {
      ctx.ui.setWidget(WIDGET_ID, undefined);
      widgetVisible = false;
    }
    return;
  }
  ctx.ui.setWidget(
    WIDGET_ID,
    (_tui: any, theme: any) => ({
      render(width: number): string[] {
        return renderWidget(width, theme);
      },
      invalidate(): void {
        widgetVisible = false;
      },
    }),
    { placement: "aboveEditor" },
  );
  widgetVisible = true;
}

export default function slackTrackerExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    sessionId = getSessionId(ctx);
    loadState(ctx?.cwd ?? process.cwd());
    updateWidget(ctx);
  });

  pi.on("tool_execution_end", async (event: any, ctx: any) => {
    if (event?.isError) return;
    const command: string = event?.args?.command ?? "";
    const resultText = resultToText(event?.result);
    const detected = detectFromText(`${command}\n${resultText}`);
    if (!detected) return;
    if (current?.url === detected.url) return;
    current = detected;
    saveState(ctx?.cwd ?? process.cwd());
    updateWidget(ctx);
  });

  pi.registerCommand("slack", {
    description:
      "Pin the active Slack thread/channel. Usage: /slack [<url> | show | hide | clear]",
    handler: async (args, ctx) => {
      const raw = (args ?? "").trim();
      const sub = raw.toLowerCase();
      const cwd = ctx?.cwd ?? process.cwd();

      if (sub === "hide") {
        hidden = true;
        saveState(cwd);
        updateWidget(ctx);
        ctx.ui.notify("Slack widget escondido.", "info");
        return;
      }
      if (sub === "show") {
        hidden = false;
        saveState(cwd);
        updateWidget(ctx);
        ctx.ui.notify(
          current ? "Slack widget visível." : "Nenhum link do Slack rastreado ainda.",
          "info",
        );
        return;
      }
      if (sub === "clear") {
        current = null;
        saveState(cwd);
        updateWidget(ctx);
        ctx.ui.notify("Slack desafixado.", "info");
        return;
      }
      if (raw) {
        const parsed = parseSlackUrl(raw);
        if (!parsed) {
          ctx.ui.notify(
            "URL inválida. Use um link slack.com/archives/... ou app.slack.com/client/...",
            "warning",
          );
          return;
        }
        current = parsed;
        hidden = false;
        saveState(cwd);
        updateWidget(ctx);
        ctx.ui.notify(`Slack fixado: ${parsed.channel}`, "info");
        return;
      }

      ctx.ui.notify(
        current
          ? `Slack atual: ${current.url}`
          : "Usage: /slack [<url> | show | hide | clear]",
        "info",
      );
    },
  });
}
