import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";

type CiState = "PENDING" | "PASS" | "FAIL" | "NONE";
type DeployState = "QUEUED" | "IN_PROGRESS" | "SUCCESS" | "FAILURE" | "NONE";

interface CiSummary {
  state: CiState;
  total: number;
  passed: number;
  failed: number;
  pending: number;
}

interface DeployInfo {
  state: DeployState;
  workflow: string;
  url: string;
  databaseId: number;
}

interface TrackedPr {
  number: number;
  repo: string;
  title: string;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  mergedAt: number | null;
  mergeCommit: string | null;
  ci: CiSummary | null;
  deploy: DeployInfo | null;
}

const POLL_INTERVAL_MS = 60_000;
const MERGED_RETENTION_MS = 24 * 60 * 60 * 1000;
const PR_URL_RE = /https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/g;
const STATE_DIR = ".pi/prs-tracker-sessions";
const DEPLOY_WORKFLOW_RE = /deploy/i;
const DEPLOY_STAGING_RE = /staging/i;

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
      if (pr && typeof pr.number === "number" && pr.repo) {
        tracked.set(keyOf(pr.repo, pr.number), pr);
      }
    }
  } catch {}
}

function keyOf(repo: string, number: number): string {
  return `${repo}#${number}`;
}

function runGh(args: string): string | null {
  try {
    return execSync(`gh ${args}`, { encoding: "utf-8", timeout: 30_000 }).trim();
  } catch {
    return null;
  }
}

function summarizeChecks(rollup: any[]): CiSummary | null {
  if (!Array.isArray(rollup) || rollup.length === 0) return null;
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const c of rollup) {
    const status: string = (c?.status ?? c?.state ?? "").toUpperCase();
    const conclusion: string = (c?.conclusion ?? "").toUpperCase();
    if (status && status !== "COMPLETED") {
      pending++;
      continue;
    }
    const outcome = conclusion || status;
    if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(outcome)) passed++;
    else if (["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "ERROR", "STALE"].includes(outcome))
      failed++;
    else pending++;
  }
  const total = rollup.length;
  let state: CiState = "NONE";
  if (failed > 0) state = "FAIL";
  else if (pending > 0) state = "PENDING";
  else if (passed > 0) state = "PASS";
  return { state, total, passed, failed, pending };
}

function fetchDeploy(repo: string, sha: string): DeployInfo | null {
  const out = runGh(
    `run list --repo ${repo} --commit ${sha} --json databaseId,name,status,conclusion,url,event --limit 20`,
  );
  if (!out) return null;
  try {
    const runs = JSON.parse(out) as Array<{
      databaseId: number;
      name: string;
      status: string;
      conclusion: string | null;
      url: string;
      event: string;
    }>;
    const deployRun = runs.find(
      (r) =>
        r.event === "push" &&
        DEPLOY_WORKFLOW_RE.test(r.name) &&
        !DEPLOY_STAGING_RE.test(r.name),
    );
    if (!deployRun) return null;
    let state: DeployState = "QUEUED";
    const status = (deployRun.status ?? "").toUpperCase();
    const conclusion = (deployRun.conclusion ?? "").toUpperCase();
    if (status === "COMPLETED") {
      state = conclusion === "SUCCESS" ? "SUCCESS" : "FAILURE";
    } else if (status === "IN_PROGRESS") {
      state = "IN_PROGRESS";
    } else {
      state = "QUEUED";
    }
    return {
      state,
      workflow: deployRun.name,
      url: deployRun.url,
      databaseId: deployRun.databaseId,
    };
  } catch {
    return null;
  }
}

function fetchPrDetails(number: number, repo: string): TrackedPr | null {
  const out = runGh(
    `pr view ${number} --repo ${repo} --json number,title,state,url,isDraft,mergedAt,mergeCommit,statusCheckRollup`,
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
      mergeCommit: { oid: string } | null;
      statusCheckRollup: any[];
    };
    const prev = tracked.get(keyOf(repo, number));
    return {
      number: data.number,
      repo,
      title: data.title,
      url: data.url,
      state: (data.state as TrackedPr["state"]) ?? "OPEN",
      isDraft: Boolean(data.isDraft),
      mergedAt: data.mergedAt ? new Date(data.mergedAt).getTime() : null,
      mergeCommit: data.mergeCommit?.oid ?? null,
      ci: summarizeChecks(data.statusCheckRollup),
      deploy: prev?.deploy ?? null,
    };
  } catch {
    return null;
  }
}

function trackPr(number: number, repo: string): boolean {
  const details = fetchPrDetails(number, repo);
  if (!details) return false;
  if (details.state === "MERGED" && details.mergeCommit && !details.deploy) {
    const deploy = fetchDeploy(repo, details.mergeCommit);
    if (deploy) details.deploy = deploy;
  }
  tracked.set(keyOf(repo, number), details);
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
      if (pr.deploy && (pr.deploy.state === "QUEUED" || pr.deploy.state === "IN_PROGRESS"))
        continue;
      tracked.delete(key);
    }
  }
}

function refreshAll(): boolean {
  let changed = false;
  for (const [key, pr] of tracked) {
    const updated = fetchPrDetails(pr.number, pr.repo);
    const next = updated ?? pr;
    if (
      next.state === "MERGED" &&
      next.mergeCommit &&
      (!next.deploy ||
        next.deploy.state === "QUEUED" ||
        next.deploy.state === "IN_PROGRESS")
    ) {
      const deploy = fetchDeploy(next.repo, next.mergeCommit);
      if (deploy) next.deploy = deploy;
    }
    if (JSON.stringify(next) !== JSON.stringify(pr)) {
      tracked.set(key, next);
      changed = true;
    }
  }
  pruneStale();
  return changed;
}

function extractPrs(text: string): void {
  PR_URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PR_URL_RE.exec(text)) !== null) {
    const repo = match[1];
    const number = Number(match[2]);
    if (repo && Number.isFinite(number)) trackPr(number, repo);
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
  const order = (pr: TrackedPr): number => {
    if (pr.state === "OPEN") return 0;
    if (pr.deploy && (pr.deploy.state === "QUEUED" || pr.deploy.state === "IN_PROGRESS")) return 1;
    return 2;
  };
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

function colorFor(pr: TrackedPr): string {
  if (pr.state === "MERGED") return "accent";
  if (pr.state === "CLOSED") return "error";
  if (pr.isDraft) return "warning";
  return "success";
}

function ciLine(pr: TrackedPr, fg: (c: string, s: string) => string): string | null {
  const ci = pr.ci;
  if (!ci || ci.state === "NONE") return null;
  const map: Record<CiState, [string, string]> = {
    PASS: ["success", "CI passed"],
    FAIL: ["error", "CI failed"],
    PENDING: ["warning", "CI running"],
    NONE: ["dim", "CI"],
  };
  const [color, label] = map[ci.state];
  const detail = `${label} (${ci.passed}/${ci.total}${ci.failed ? `, ${ci.failed} failed` : ""})`;
  return fg(color, detail);
}

function deployLine(pr: TrackedPr, fg: (c: string, s: string) => string): string | null {
  const d = pr.deploy;
  if (!d || d.state === "NONE") return null;
  const map: Record<DeployState, [string, string]> = {
    QUEUED: ["warning", "deploy queued"],
    IN_PROGRESS: ["warning", "deploying to main"],
    SUCCESS: ["success", "deployed to main"],
    FAILURE: ["error", "deploy failed"],
    NONE: ["dim", "deploy"],
  };
  const [color, label] = map[d.state];
  return fg(color, label);
}

function renderWidget(width: number, theme: any): string[] {
  const prs = sortedPrs();
  const lines: string[] = [];
  const trunc = (s: string): string => (s.length > width ? `${s.slice(0, width - 1)}…` : s);
  const fg = (color: string, s: string): string => (theme?.fg ? theme.fg(color, s) : s);
  const bold = (s: string): string => (theme?.bold ? theme.bold(s) : s);

  const open = prs.filter((p) => p.state === "OPEN").length;
  const merged = prs.filter((p) => p.state === "MERGED").length;
  const deploying = prs.filter(
    (p) => p.deploy && (p.deploy.state === "QUEUED" || p.deploy.state === "IN_PROGRESS"),
  ).length;
  const headerParts = [`${open} open`];
  if (merged) headerParts.push(`${merged} merged`);
  if (deploying) headerParts.push(`${deploying} deploying`);
  const header = ` PRs — ${headerParts.join(", ")}`;
  lines.push(bold(fg("accent", trunc(header))));

  const max = 12;
  for (const pr of prs.slice(0, max)) {
    const color = colorFor(pr);
    const tag = fg(color, bold(labelFor(pr).toUpperCase()));
    const head = trunc(`#${pr.number} ${pr.title}`);
    lines.push(`   ${tag} ${fg("text", head)}`);
    const ci = ciLine(pr, fg);
    const deploy = deployLine(pr, fg);
    const status = [ci, deploy].filter(Boolean).join(fg("dim", "  ·  "));
    if (status) lines.push(`      ${trunc(status)}`);
    lines.push(`      ${fg("mdLinkUrl", trunc(pr.url))}`);
  }
  if (prs.length > max) lines.push(fg("dim", `   +${prs.length - max} more`));
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
    extractPrs(`${command}\n${resultText}`);

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
