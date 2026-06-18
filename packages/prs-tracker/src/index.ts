import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";

interface TrackedPr {
  number: number;
  repoDir: string;
  title: string;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  mergedAt: number | null;
}

const POLL_INTERVAL_MS = 60_000;
const MERGED_RETENTION_MS = 24 * 60 * 60 * 1000;
const PR_URL_RE = /https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/g;
const STATE_DIR = ".pi/prs-tracker-sessions";

const tracked = new Map<string, TrackedPr>();
let hidden = false;
let widgetVisible = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let uiCtx: any = null;
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
    writeFileSync(path, JSON.stringify({ hidden, prs: [...tracked.values()] }, null, 2));
  } catch {}
}

function loadState(cwd: string): void {
  const path = getStatePath(cwd);
  if (!path || !existsSync(path)) return;
  try {
    const state = JSON.parse(readFileSync(path, "utf-8")) as {
      hidden?: boolean;
      prs?: TrackedPr[];
    };
    hidden = Boolean(state.hidden);
    tracked.clear();
    for (const pr of state.prs ?? []) {
      if (pr && typeof pr.number === "number" && pr.repoDir) {
        tracked.set(keyOf(pr.repoDir, pr.number), pr);
      }
    }
  } catch {}
}

function keyOf(repoDir: string, number: number): string {
  return `${repoDir}#${number}`;
}

function runGh(args: string, cwd: string): string | null {
  try {
    return execSync(`gh ${args}`, { cwd, encoding: "utf-8", timeout: 30_000 }).trim();
  } catch {
    return null;
  }
}

function fetchPrDetails(number: number, repoDir: string): TrackedPr | null {
  const out = runGh(
    `pr view ${number} --json number,title,state,url,isDraft,mergedAt`,
    repoDir,
  );
  if (!out) return null;
  try {
    const data = JSON.parse(out) as {
      number: number;
      title: string;
      state: string;
      url: string;
      isDraft: boolean;
      mergedAt: string | null;
    };
    return {
      number: data.number,
      repoDir,
      title: data.title,
      url: data.url,
      state: (data.state as TrackedPr["state"]) ?? "OPEN",
      isDraft: Boolean(data.isDraft),
      mergedAt: data.mergedAt ? new Date(data.mergedAt).getTime() : null,
    };
  } catch {
    return null;
  }
}

function trackPr(number: number, repoDir: string): boolean {
  const details = fetchPrDetails(number, repoDir);
  if (!details) return false;
  tracked.set(keyOf(repoDir, number), details);
  return true;
}

function pruneStale(): void {
  const now = Date.now();
  for (const [key, pr] of tracked) {
    if (pr.state === "CLOSED") {
      tracked.delete(key);
      continue;
    }
    if (pr.state === "MERGED" && pr.mergedAt && now - pr.mergedAt > MERGED_RETENTION_MS) {
      tracked.delete(key);
    }
  }
}

function refreshAll(): boolean {
  let changed = false;
  for (const [key, pr] of tracked) {
    const updated = fetchPrDetails(pr.number, pr.repoDir);
    if (updated && JSON.stringify(updated) !== JSON.stringify(pr)) {
      tracked.set(key, updated);
      changed = true;
    }
  }
  pruneStale();
  return changed;
}

function extractPrs(text: string, cwd: string): void {
  PR_URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PR_URL_RE.exec(text)) !== null) {
    const number = Number(match[1]);
    if (Number.isFinite(number)) trackPr(number, cwd);
  }
}

function resultToText(result: any): string {
  if (!result) return "";
  if (typeof result === "string") return result;
  const parts: string[] = [];
  const content = result.content ?? result.output ?? result;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === "string") parts.push(item);
      else if (item?.text) parts.push(String(item.text));
    }
  } else if (typeof content === "string") {
    parts.push(content);
  }
  return parts.join("\n");
}

function sortedPrs(): TrackedPr[] {
  const order = (pr: TrackedPr): number => (pr.state === "OPEN" ? 0 : 1);
  return [...tracked.values()].sort((a, b) => {
    const byState = order(a) - order(b);
    if (byState !== 0) return byState;
    return b.number - a.number;
  });
}

function labelFor(pr: TrackedPr): string {
  if (pr.state === "MERGED") return "merged";
  if (pr.state === "CLOSED") return "closed";
  if (pr.isDraft) return "draft";
  return "open";
}

function renderWidget(width: number, theme: any): string[] {
  const prs = sortedPrs();
  const lines: string[] = [];
  const trunc = (s: string): string => (s.length > width ? `${s.slice(0, width - 1)}…` : s);
  const dim = (s: string): string => (theme?.dim ? theme.dim(s) : s);

  const open = prs.filter((p) => p.state === "OPEN").length;
  const merged = prs.filter((p) => p.state === "MERGED").length;
  const header = ` PRs - ${open} open${merged ? `, ${merged} merged` : ""}`;
  lines.push(theme?.bold ? theme.bold(trunc(header)) : trunc(header));

  const max = 12;
  for (const pr of prs.slice(0, max)) {
    const title = `   [${labelFor(pr)}] #${pr.number} ${pr.title}`;
    lines.push(trunc(title));
    lines.push(dim(trunc(`      ${pr.url}`)));
  }
  if (prs.length > max) lines.push(trunc(`   +${prs.length - max} more`));
  return lines;
}

function updateWidget(ctx: any): void {
  uiCtx = ctx;
  if (!ctx?.ui?.setWidget) return;

  if (hidden || tracked.size === 0) {
    if (widgetVisible) {
      ctx.ui.setWidget("pi-prs-tracker", undefined);
      widgetVisible = false;
    }
    return;
  }

  ctx.ui.setWidget(
    "pi-prs-tracker",
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

function startPolling(ctx: any): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (tracked.size === 0) return;
    const changed = refreshAll();
    if (changed) {
      saveState(ctx?.cwd ?? uiCtx?.cwd ?? process.cwd());
      updateWidget(ctx);
    }
  }, POLL_INTERVAL_MS);
  if (typeof pollTimer.unref === "function") pollTimer.unref();
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export default function prsTrackerExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    sessionId = getSessionId(ctx);
    loadState(ctx?.cwd ?? process.cwd());
    if (tracked.size > 0) refreshAll();
    startPolling(ctx);
    updateWidget(ctx);
  });

  pi.on("session_shutdown", async () => {
    stopPolling();
  });

  pi.on("tool_execution_end", async (event: any, ctx: any) => {
    const name = event?.toolName;
    if (name !== "bash" || event?.isError) return;

    const before = tracked.size;
    const beforeSnapshot = JSON.stringify([...tracked.values()]);
    const cwd = ctx?.cwd ?? process.cwd();
    const command: string = event?.args?.command ?? "";
    const resultText = resultToText(event?.result);
    extractPrs(`${command}\n${resultText}`, cwd);

    if (tracked.size !== before || JSON.stringify([...tracked.values()]) !== beforeSnapshot) {
      saveState(cwd);
      updateWidget(ctx);
    }
  });

  pi.registerCommand("prs", {
    description: "Manage the pinned PRs widget. Usage: /prs [show|hide|refresh]",
    handler: async (args, ctx) => {
      const sub = (args ?? "").trim().toLowerCase();

      switch (sub) {
        case "hide":
          hidden = true;
          saveState(ctx?.cwd ?? process.cwd());
          updateWidget(ctx);
          ctx.ui.notify("PRs widget oculto. Use /prs show para reexibir.", "info");
          break;

        case "show":
          hidden = false;
          saveState(ctx?.cwd ?? process.cwd());
          updateWidget(ctx);
          ctx.ui.notify(
            tracked.size === 0
              ? "Nenhum PR rastreado ainda nesta sessão."
              : "PRs widget visível.",
            "info",
          );
          break;

        case "refresh":
        case "": {
          if (sub === "refresh") {
            refreshAll();
            saveState(ctx?.cwd ?? process.cwd());
            updateWidget(ctx);
            ctx.ui.notify(`PRs atualizados (${tracked.size} rastreado(s)).`, "info");
          } else {
            ctx.ui.notify("Usage: /prs [show|hide|refresh]", "info");
          }
          break;
        }

        default:
          ctx.ui.notify("Usage: /prs [show|hide|refresh]", "warning");
      }
    },
  });
}
