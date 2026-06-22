import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";

interface LinearLink {
  url: string;
  team: string;
  issueId: string;
  slug: string;
}

const STATE_DIR = ".pi/linear-tracker-sessions";
const WIDGET_ID = "pi-linear-tracker";
const LINEAR_URL_RE =
  /https?:\/\/linear\.app\/([^/\s]+)\/issue\/([A-Z]{2,}-\d+)(?:\/([^\s)"']*))?/gi;

let current: LinearLink | null = null;
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
      current?: LinearLink | null;
    };
    hidden = Boolean(state.hidden);
    current = state.current && state.current.url ? state.current : null;
  } catch {}
}

function parseLinearUrl(raw: string): LinearLink | null {
  LINEAR_URL_RE.lastIndex = 0;
  const m = LINEAR_URL_RE.exec(raw);
  if (!m) return null;
  return {
    url: m[0],
    team: m[1],
    issueId: m[2].toUpperCase(),
    slug: m[3] ?? "",
  };
}

function detectFromText(text: string): LinearLink | null {
  LINEAR_URL_RE.lastIndex = 0;
  let last: LinearLink | null = null;
  let m: RegExpExecArray | null;
  while ((m = LINEAR_URL_RE.exec(text)) !== null) {
    last = {
      url: m[0],
      team: m[1],
      issueId: m[2].toUpperCase(),
      slug: m[3] ?? "",
    };
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

function titleFromSlug(slug: string): string {
  if (!slug) return "";
  const noTail = slug.split(/[?#]/)[0].replace(/\/+$/, "");
  const last = noTail.split("/").pop() ?? "";
  const words = last.replace(/-/g, " ").trim();
  if (!words) return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function renderWidget(width: number, theme: any): string[] {
  if (!current) return [];
  const fg = (color: string, s: string): string =>
    theme?.fg ? theme.fg(color, s) : s;
  const bold = (s: string): string => (theme?.bold ? theme.bold(s) : s);
  const trunc = (s: string, max: number): string =>
    s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;

  const tag = bold(fg("accent", current.issueId));
  const title = titleFromSlug(current.slug);
  const head = title
    ? `${tag} ${fg("text", trunc(title, Math.max(8, width - current.issueId.length - 12)))}`
    : tag;
  const lines: string[] = [];
  lines.push(`${fg("accent", " ◆ Linear")}  ${head}`);
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

export default function linearTrackerExtension(pi: ExtensionAPI): void {
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

  pi.registerCommand("linear", {
    description:
      "Pin the active Linear issue. Usage: /linear [<url> | show | hide | clear]",
    handler: async (args, ctx) => {
      const raw = (args ?? "").trim();
      const sub = raw.toLowerCase();
      const cwd = ctx?.cwd ?? process.cwd();

      if (sub === "hide") {
        hidden = true;
        saveState(cwd);
        updateWidget(ctx);
        ctx.ui.notify("Linear widget escondido.", "info");
        return;
      }
      if (sub === "show") {
        hidden = false;
        saveState(cwd);
        updateWidget(ctx);
        ctx.ui.notify(
          current ? "Linear widget visível." : "Nenhuma issue do Linear rastreada ainda.",
          "info",
        );
        return;
      }
      if (sub === "clear") {
        current = null;
        saveState(cwd);
        updateWidget(ctx);
        ctx.ui.notify("Linear desafixado.", "info");
        return;
      }
      if (raw) {
        const parsed = parseLinearUrl(raw);
        if (!parsed) {
          ctx.ui.notify(
            "URL inválida. Use um link linear.app/<team>/issue/<ID>.",
            "warning",
          );
          return;
        }
        current = parsed;
        hidden = false;
        saveState(cwd);
        updateWidget(ctx);
        ctx.ui.notify(`Linear fixado: ${parsed.issueId}`, "info");
        return;
      }

      ctx.ui.notify(
        current
          ? `Linear atual: ${current.issueId} — ${current.url}`
          : "Usage: /linear [<url> | show | hide | clear]",
        "info",
      );
    },
  });
}
