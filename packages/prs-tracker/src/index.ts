import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";

type CiState = "PENDING" | "PASS" | "FAIL" | "NONE";
type DeployState = "QUEUED" | "IN_PROGRESS" | "SUCCESS" | "FAILURE" | "SKIPPED" | "NONE";

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
const DEPLOY_WORKFLOW_RE = /deploy|publish|release/i;
const DEPLOY_STAGING_RE = /staging/i;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 120;

const tracked = new Map<string, TrackedPr>();
let hidden = false;
let hideMerged = false;
let widgetVisible = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let spinnerTimer: ReturnType<typeof setInterval> | null = null;
let spinnerTick = 0;
let uiCtx: any = null;
let sessionId = `mem-${Date.now()}`;

function spinnerFrame(): string {
  return SPINNER_FRAMES[spinnerTick % SPINNER_FRAMES.length];
}

function hasActiveState(): boolean {
  for (const pr of tracked.values()) {
    if (pr.state !== "OPEN" && pr.state !== "MERGED") continue;
    if (pr.ci && pr.ci.state === "PENDING") return true;
    if (pr.deploy && (pr.deploy.state === "QUEUED" || pr.deploy.state === "IN_PROGRESS")) return true;
  }
  return false;
}

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
    writeFileSync(path, JSON.stringify({ hidden, hideMerged, prs: [...tracked.values()] }, null, 2));
  } catch {}
}

function loadState(cwd: string): void {
  const path = getStatePath(cwd);
  if (!path || !existsSync(path)) return;
  try {
    const state = JSON.parse(readFileSync(path, "utf-8")) as {
      hidden?: boolean;
      hideMerged?: boolean;
      prs?: TrackedPr[];
    };
    hidden = Boolean(state.hidden);
    hideMerged = Boolean(state.hideMerged);
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
    let outcome: string;
    if (c?.__typename === "StatusContext") {
      outcome = (c?.state ?? "").toUpperCase();
    } else {
      const status: string = (c?.status ?? "").toUpperCase();
      if (status && status !== "COMPLETED") {
        pending++;
        continue;
      }
      outcome = (c?.conclusion ?? "").toUpperCase();
    }
    if (["SUCCESS", "NEUTRAL", "SKIPPED", "EXPECTED"].includes(outcome)) passed++;
    else if (
      ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "ERROR", "STALE"].includes(outcome)
    )
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

function jobStateToDeploy(status: string, conclusion: string): DeployState {
  const s = status.toUpperCase();
  const c = conclusion.toUpperCase();
  if (s === "COMPLETED") {
    if (c === "SUCCESS") return "SUCCESS";
    if (c === "SKIPPED" || c === "NEUTRAL") return "SKIPPED";
    return "FAILURE";
  }
  if (s === "IN_PROGRESS") return "IN_PROGRESS";
  return "QUEUED";
}

function findDeployJob(
  repo: string,
  databaseId: number,
): { name: string; status: string; conclusion: string } | null {
  const out = runGh(`run view ${databaseId} --repo ${repo} --json jobs`);
  if (!out) return null;
  try {
    const data = JSON.parse(out) as {
      jobs?: Array<{ name: string; status: string; conclusion: string | null }>;
    };
    const job = (data.jobs ?? []).find(
      (j) => DEPLOY_WORKFLOW_RE.test(j.name) && !DEPLOY_STAGING_RE.test(j.name),
    );
    if (!job) return null;
    return { name: job.name, status: job.status ?? "", conclusion: job.conclusion ?? "" };
  } catch {
    return null;
  }
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
    const pushRuns = runs.filter((r) => r.event === "push");

    const namedRun = pushRuns.find(
      (r) => DEPLOY_WORKFLOW_RE.test(r.name) && !DEPLOY_STAGING_RE.test(r.name),
    );
    if (namedRun) {
      return {
        state: jobStateToDeploy(namedRun.status ?? "", namedRun.conclusion ?? ""),
        workflow: namedRun.name,
        url: namedRun.url,
        databaseId: namedRun.databaseId,
      };
    }

    for (const run of pushRuns) {
      const job = findDeployJob(repo, run.databaseId);
      if (job) {
        return {
          state: jobStateToDeploy(job.status, job.conclusion),
          workflow: `${run.name} / ${job.name}`,
          url: run.url,
          databaseId: run.databaseId,
        };
      }
    }
    return null;
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
    const before = JSON.stringify(pr);
    const updated = fetchPrDetails(pr.number, pr.repo);
    const next = updated ?? { ...pr };
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
    if (JSON.stringify(next) !== before) {
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
  return [...tracked.values()]
    .filter((pr) => !(hideMerged && pr.state === "MERGED"))
    .sort((a, b) => {
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
    PENDING: ["warning", `${spinnerFrame()} CI running`],
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
    QUEUED: ["warning", `${spinnerFrame()} Deploy queued`],
    IN_PROGRESS: ["warning", `${spinnerFrame()} Deploying to main`],
    SUCCESS: ["success", "Deployed to main"],
    FAILURE: ["error", "Deploy failed"],
    SKIPPED: ["dim", "Deploy skipped"],
    NONE: ["dim", "Deploy"],
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

  const all = [...tracked.values()];
  const open = all.filter((p) => p.state === "OPEN").length;
  const merged = all.filter((p) => p.state === "MERGED").length;
  const deploying = all.filter(
    (p) => p.deploy && (p.deploy.state === "QUEUED" || p.deploy.state === "IN_PROGRESS"),
  ).length;
  const headerParts = [`${open} open`];
  if (merged) headerParts.push(hideMerged ? `${merged} merged (hidden)` : `${merged} merged`);
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
    stopSpinner();
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
  if (hasActiveState()) startSpinner(ctx);
  else stopSpinner();
}

function startSpinner(ctx: any): void {
  if (spinnerTimer) return;
  spinnerTimer = setInterval(() => {
    if (hidden || tracked.size === 0 || !hasActiveState()) {
      stopSpinner();
      return;
    }
    spinnerTick++;
    renderWidgetNow(ctx ?? uiCtx);
  }, SPINNER_INTERVAL_MS);
  if (typeof spinnerTimer.unref === "function") spinnerTimer.unref();
}

function stopSpinner(): void {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
  }
}

function renderWidgetNow(ctx: any): void {
  if (!ctx?.ui?.setWidget || hidden || tracked.size === 0) return;
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
    stopSpinner();
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
    description: "Manage the pinned PRs widget. Usage: /prs [show|hide|merged|refresh]",
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

        case "merged":
          hideMerged = !hideMerged;
          saveState(ctx?.cwd ?? process.cwd());
          updateWidget(ctx);
          ctx.ui.notify(
            hideMerged ? "PRs merged ocultos." : "PRs merged visíveis.",
            "info",
          );
          break;

        default:
          ctx.ui.notify("Usage: /prs [show|hide|merged|refresh]", "warning");
      }
    },
  });
}
