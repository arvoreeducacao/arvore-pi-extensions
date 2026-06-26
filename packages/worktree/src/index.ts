import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { execSync, spawnSync, spawn } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, readdirSync, statSync, symlinkSync, writeFileSync, mkdirSync, openSync, closeSync } from "node:fs";
import { join, resolve, basename } from "node:path";

let activeWorktree: string | null = null;
let activeWorktreePaths: Map<string, string> = new Map();
let worktreeMode = true;
let widgetHidden = false;

const TREE_NAMES = [
  "africanosa", "alfabetonio", "arqueoptera", "arterieira", "artilheira",
  "arventueira", "audiolivronio", "autoajosa", "biografosa", "biteria",
  "cidadona", "comedula", "contore", "cordeleira", "cronicea",
  "dramalheira", "dribla-dendro", "entrosadeira", "espinhosa", "fabuleiro",
  "fanfiqueira", "fantasiera", "felicideira", "fictea", "folclorilia",
  "gamesta", "genetivia", "humanita", "ideiativa", "intradiversieira",
  "lendariuna", "liderata", "literatera", "livronio", "luminaurea",
  "mangazeira", "metropolita", "mistieira", "moderata", "olimpica",
  "planetaria", "poesieira", "quadrinheiro", "romanceiro", "sabideira",
  "streameira", "tempestina", "terronia", "torcideira",
];

const WORKTREES_DIR = ".worktrees";
const SETUP_DIR = ".pi/worktree-setup";

interface SetupConfig {
  defaultSymlink?: string[];
  background?: boolean;
  repos?: Record<string, { symlink?: string[]; background?: boolean }>;
}

function getSetupDir(repoPath: string): string {
  const root = findHubRoot(repoPath) || repoPath;
  return join(root, SETUP_DIR);
}

function loadSetupConfig(repoPath: string): SetupConfig | null {
  const path = join(getSetupDir(repoPath), "setup.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SetupConfig;
  } catch (e) {
    process.stderr.write(`[pi-worktree] Invalid setup.json: ${(e as Error).message}\n`);
    return null;
  }
}

function pickAvailableName(repoPath: string): string | null {
  const dir = join(repoPath, WORKTREES_DIR);
  const existing = new Set<string>();
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir)) {
      if (statSync(join(dir, entry)).isDirectory()) existing.add(entry);
    }
  }
  const available = TREE_NAMES.filter((n) => !existing.has(n));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

function ensureGitignore(repoPath: string): void {
  const gitignorePath = join(repoPath, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (content.includes(WORKTREES_DIR)) return;
    appendFileSync(gitignorePath, `\n${WORKTREES_DIR}/\n`);
  } else {
    appendFileSync(gitignorePath, `${WORKTREES_DIR}/\n`);
  }
}

function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

function discoverRepos(cwd: string): string[] {
  const hubRoot = findHubRoot(cwd);
  if (!hubRoot) return isGitRepo(cwd) ? [cwd] : [];

  const repos: string[] = [];
  for (const entry of readdirSync(hubRoot)) {
    const full = join(hubRoot, entry);
    if (statSync(full).isDirectory() && isGitRepo(full)) repos.push(full);
  }
  return repos.sort((a, b) => basename(a).localeCompare(basename(b)));
}

function findHubRoot(cwd: string): string | null {
  let dir = cwd;
  let prev = "";
  while (dir !== prev) {
    if (existsSync(join(dir, "AGENTS.md")) || existsSync(join(dir, "hub.config.ts"))) return dir;
    prev = dir;
    dir = resolve(dir, "..");
  }
  return null;
}

function getCurrentBranch(repoPath: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd: repoPath, encoding: "utf-8" }).trim();
  } catch {
    return "main";
  }
}

function getDefaultBranch(repoPath: string): string | null {
  try {
    const ref = execSync("git symbolic-ref --quiet refs/remotes/origin/HEAD", { cwd: repoPath, encoding: "utf-8" }).trim();
    const name = ref.replace(/^refs\/remotes\/origin\//, "");
    return name || null;
  } catch {
    for (const candidate of ["main", "master"]) {
      const check = spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`], { cwd: repoPath, encoding: "utf-8" });
      if (check.status === 0) return candidate;
    }
    return null;
  }
}

function fetchBase(repoPath: string, base: string): boolean {
  const result = spawnSync("git", ["fetch", "origin", base, "--quiet"], { cwd: repoPath, encoding: "utf-8" });
  return result.status === 0;
}

function getExistingWorktrees(repoPath: string): Array<{ name: string; branch: string; path: string }> {
  const dir = join(repoPath, WORKTREES_DIR);
  if (!existsSync(dir)) return [];

  const entries: Array<{ name: string; branch: string; path: string }> = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (!existsSync(join(full, ".git"))) continue;
    let branch = "unknown";
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: full, encoding: "utf-8" }).trim();
    } catch {}
    entries.push({ name: entry, branch, path: full });
  }
  return entries;
}

function matchesPattern(entry: string, pattern: string): boolean {
  if (pattern.endsWith("*")) return entry.startsWith(pattern.slice(0, -1));
  return entry === pattern.replace(/\/$/, "");
}

function symlinkMatching(repoPath: string, targetDir: string, patterns: string[]): string[] {
  const linked: string[] = [];
  for (const entry of readdirSync(repoPath)) {
    if (!patterns.some((p) => matchesPattern(entry, p))) continue;
    const src = join(repoPath, entry);
    const dest = join(targetDir, entry);
    if (existsSync(dest)) continue;
    try {
      symlinkSync(src, dest);
      linked.push(entry);
    } catch (e) {
      process.stderr.write(`[pi-worktree] Failed to symlink ${entry}: ${(e as Error).message}\n`);
    }
  }
  return linked;
}

function autoInstall(repoPath: string, targetDir: string): void {
  if (existsSync(join(repoPath, "package.json")) && !existsSync(join(targetDir, "node_modules"))) {
    const pm = existsSync(join(repoPath, "pnpm-lock.yaml")) ? "pnpm" : existsSync(join(repoPath, "yarn.lock")) ? "yarn" : "npm";
    spawn(pm, ["install"], { cwd: targetDir, stdio: "ignore", detached: true }).unref();
  }
}

function runSetupScript(scriptPath: string, repoPath: string, targetDir: string): { ok: boolean; output: string } {
  const result = spawnSync("bash", [scriptPath], {
    cwd: targetDir,
    encoding: "utf-8",
    env: {
      ...process.env,
      WT_REPO: targetDir,
      WT_MAIN: repoPath,
      WT_NAME: basename(targetDir),
      WT_REPO_NAME: basename(repoPath),
    },
  });
  if (result.error) return { ok: false, output: result.error.message };
  const output = [result.stdout, result.stderr].filter(Boolean).join("").trim();
  return { ok: result.status === 0, output };
}

function setupLogPath(targetDir: string): string {
  const gitFile = join(targetDir, ".git");
  try {
    const content = readFileSync(gitFile, "utf-8").trim();
    const match = content.match(/^gitdir:\s*(.+)$/);
    if (match) return join(match[1].trim(), "pi-worktree-setup.log");
  } catch {}
  return join(targetDir, ".pi-worktree-setup.log");
}

function runSetupScriptBackground(scriptPath: string, repoPath: string, targetDir: string): string {
  const logPath = setupLogPath(targetDir);
  const fd = openSync(logPath, "w");
  const child = spawn("bash", [scriptPath], {
    cwd: targetDir,
    stdio: ["ignore", fd, fd],
    detached: true,
    env: {
      ...process.env,
      WT_REPO: targetDir,
      WT_MAIN: repoPath,
      WT_NAME: basename(targetDir),
      WT_REPO_NAME: basename(repoPath),
    },
  });
  child.unref();
  closeSync(fd);
  return logPath;
}

function runRepoSetup(repoPath: string, targetDir: string): string {
  const repoName = basename(repoPath);
  const config = loadSetupConfig(repoPath);
  const symlinkPatterns = config?.repos?.[repoName]?.symlink ?? config?.defaultSymlink ?? [".env*"];
  const linked = symlinkMatching(repoPath, targetDir, symlinkPatterns);
  const linkedNote = linked.length ? ` (linked ${linked.join(", ")})` : "";
  const background = config?.repos?.[repoName]?.background ?? config?.background ?? false;

  const scriptPath = join(getSetupDir(repoPath), `${repoName}.sh`);
  if (existsSync(scriptPath)) {
    if (background) {
      const logPath = runSetupScriptBackground(scriptPath, repoPath, targetDir);
      return `setup: ${repoName}.sh ⧖ background${linkedNote}\n  log: ${logPath}`;
    }
    const { ok, output } = runSetupScript(scriptPath, repoPath, targetDir);
    if (ok) return `setup: ${repoName}.sh ✓${linkedNote}`;
    const tail = output ? `\n${output.split("\n").slice(-6).join("\n")}` : "";
    return `setup: ${repoName}.sh ✗${tail}`;
  }

  autoInstall(repoPath, targetDir);
  return `setup: default${linkedNote}`;
}

function createWorktree(repoPath: string, name: string, branch?: string): { ok: boolean; message: string } {
  const targetDir = join(repoPath, WORKTREES_DIR, name);
  if (existsSync(targetDir)) return { ok: false, message: `Worktree '${name}' already exists in ${basename(repoPath)}` };

  ensureGitignore(repoPath);

  const newBranch = branch || `wt/${name}`;
  const defaultBranch = getDefaultBranch(repoPath);
  let startPoint: string | null = null;
  if (defaultBranch && fetchBase(repoPath, defaultBranch)) {
    startPoint = `origin/${defaultBranch}`;
  }

  const addArgs = startPoint
    ? ["worktree", "add", "-b", newBranch, targetDir, startPoint]
    : ["worktree", "add", "-b", newBranch, targetDir];
  const result = spawnSync("git", addArgs, {
    cwd: repoPath,
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    const err = result.stderr?.trim() || "Unknown error";
    if (err.includes("already exists")) {
      const result2 = spawnSync("git", ["worktree", "add", targetDir, branch || getCurrentBranch(repoPath)], {
        cwd: repoPath,
        encoding: "utf-8",
      });
      if (result2.status !== 0) return { ok: false, message: `Failed: ${result2.stderr?.trim()}` };
      const setup2 = runRepoSetup(repoPath, targetDir);
      return { ok: true, message: `Created worktree '${name}' in ${basename(repoPath)} (existing branch)\n  ${setup2}` };
    }
    return { ok: false, message: `Failed: ${err}` };
  }

  const setup = runRepoSetup(repoPath, targetDir);
  const baseNote = startPoint ? ` (from ${startPoint})` : "";
  return { ok: true, message: `Created worktree '${name}' in ${basename(repoPath)} → branch ${newBranch}${baseNote}\n  ${setup}` };
}

function removeWorktree(repoPath: string, name: string): { ok: boolean; message: string } {
  const targetDir = join(repoPath, WORKTREES_DIR, name);
  if (!existsSync(targetDir)) return { ok: false, message: `Worktree '${name}' not found in ${basename(repoPath)}` };

  const result = spawnSync("git", ["worktree", "remove", targetDir, "--force"], {
    cwd: repoPath,
    encoding: "utf-8",
  });

  if (result.status !== 0) return { ok: false, message: `Failed: ${result.stderr?.trim()}` };
  return { ok: true, message: `Removed worktree '${name}' from ${basename(repoPath)}` };
}

function getProcessCwd(pid: number): string | null {
  const result = spawnSync("lsof", ["-a", "-d", "cwd", "-p", String(pid), "-Fn"], { encoding: "utf-8" });
  for (const line of (result.stdout || "").split("\n")) {
    if (line.startsWith("n")) return line.slice(1);
  }
  return null;
}

function findProcessesUsingDir(dir: string): Array<{ pid: number; command: string }> {
  const ps = spawnSync("ps", ["-A", "-o", "pid=", "-o", "command="], { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 });
  const candidates: Array<{ pid: number; command: string }> = [];
  for (const line of (ps.stdout || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx < 0) continue;
    const pid = parseInt(trimmed.slice(0, spaceIdx), 10);
    const command = trimmed.slice(spaceIdx + 1);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    if (command.includes(dir)) candidates.push({ pid, command });
  }

  const matches: Array<{ pid: number; command: string }> = [];
  for (const c of candidates) {
    const cwd = getProcessCwd(c.pid);
    if (cwd && (cwd === dir || cwd.startsWith(dir + "/"))) {
      matches.push({ pid: c.pid, command: c.command.slice(0, 80) });
    }
  }
  return matches;
}

function killProcesses(pids: number[]): void {
  for (const pid of pids) {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  spawnSync("sleep", ["1"]);
  for (const pid of pids) {
    try { process.kill(pid, 0); process.kill(pid, "SIGKILL"); } catch {}
  }
}

function isWorktreeDirty(worktreePath: string): boolean {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd: worktreePath, encoding: "utf-8" });
  if (result.status !== 0) return false;
  return (result.stdout || "").trim().length > 0;
}

function isBranchMergedIntoBase(repoPath: string, branch: string): boolean {
  const base = getDefaultBranch(repoPath);
  if (!base) return false;
  fetchBase(repoPath, base);
  const merged = spawnSync("git", ["branch", "--merged", `origin/${base}`, "--format=%(refname:short)"], {
    cwd: repoPath,
    encoding: "utf-8",
  });
  if (merged.status === 0) {
    const names = (merged.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
    if (names.includes(branch)) return true;
  }
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", branch, `origin/${base}`], {
    cwd: repoPath,
    encoding: "utf-8",
  });
  return ancestor.status === 0;
}

function findMergedWorktrees(repoPath: string, exclude: Set<string>): Array<{ name: string; branch: string; path: string }> {
  return getExistingWorktrees(repoPath)
    .filter((wt) => !exclude.has(wt.name))
    .filter((wt) => wt.branch !== "unknown" && isBranchMergedIntoBase(repoPath, wt.branch))
    .map((wt) => ({ name: wt.name, branch: wt.branch, path: wt.path }));
}

function bumpPackageVersion(packageJsonPath: string, kind: "patch" | "minor" | "major"): { from: string; to: string } | null {
  if (!existsSync(packageJsonPath)) return null;
  let pkg: any;
  try {
    pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  } catch {
    return null;
  }
  const current = String(pkg.version || "0.0.0");
  const [major, minor, patch] = current.split(".").map((n) => parseInt(n, 10) || 0);
  let next: string;
  if (kind === "major") next = `${major + 1}.0.0`;
  else if (kind === "minor") next = `${major}.${minor + 1}.0`;
  else next = `${major}.${minor}.${patch + 1}`;
  pkg.version = next;
  writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n");
  return { from: current, to: next };
}

function formatHelp(): string {
  return [
    "Usage: /worktree <command> [options]",
    "",
    "Commands:",
    "  create [--repos repo1,repo2] [--name slug] [--branch name]",
    "  use    <name>     — activate worktree (agent works in worktree paths)",
    "  stop              — deactivate current worktree",
    "  mode   [on|off]   — toggle worktree mode (agent auto-creates worktrees)",
    "  widget [on|off]   — show/hide the worktree status widget",
    "  shell             — open Herdr panes, tmux panes, or Warp tabs in the worktree (Herdr/tmux/Warp only)",
    "  list   [--repos repo1,repo2]",
    "  delete <name> [--repos repo1,repo2]",
    "  clean  [--repos ...] [--bump patch|minor|major] [--dry-run] [--no-pr] [--yes]",
    "                    — remove worktrees whose branch is merged into the base,",
    "                      then bump @arvoretech/pi-worktree and open a PR.",
    "                      Shows a confirmation with running processes and dirty",
    "                      worktrees first (kills processes before removing).",
    "                      --dry-run previews, --yes skips confirmation, --no-pr",
    "                      bumps locally without committing.",
    "",
    "If --repos is omitted, shows interactive picker.",
    "If --name is omitted on create, picks a random tree name.",
    "",
    "Setup on create: runs .pi/worktree-setup/<repo>.sh if present (cwd=worktree,",
    "  env: $WT_REPO $WT_MAIN $WT_NAME $WT_REPO_NAME). Otherwise symlinks .env* and",
    "  auto-installs node deps. Symlink globs + background flag in .pi/worktree-setup/setup.json.",
  ].join("\n");
}

function parseArgs(input: string): { command: string; flags: Record<string, string> } {
  const parts = input.trim().split(/\s+/);
  const command = parts[0] || "help";
  const flags: Record<string, string> = {};

  for (let i = 1; i < parts.length; i++) {
    if (parts[i].startsWith("--")) {
      const key = parts[i].slice(2);
      const value = parts[i + 1] && !parts[i + 1].startsWith("--") ? parts[++i] : "";
      flags[key] = value;
    } else if (!flags._positional) {
      flags._positional = parts[i];
    }
  }
  return { command, flags };
}

const STATE_DIR = ".pi/worktree-sessions";

interface WorktreeState {
  mode: boolean;
  active: string | null;
  paths: Record<string, string>;
  widgetHidden?: boolean;
}

function getStatePath(cwd: string, sessionId: string): string | null {
  const root = findHubRoot(cwd);
  return root ? join(root, STATE_DIR, `${sessionId}.json`) : null;
}

function saveState(cwd: string, sessionId: string): void {
  const path = getStatePath(cwd, sessionId);
  if (!path) return;
  const state: WorktreeState = { mode: worktreeMode, active: activeWorktree, paths: Object.fromEntries(activeWorktreePaths), widgetHidden };
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

function loadState(cwd: string, sessionId: string): void {
  const path = getStatePath(cwd, sessionId);
  if (!path || !existsSync(path)) return;
  try {
    const state: WorktreeState = JSON.parse(readFileSync(path, "utf-8"));
    worktreeMode = state.mode;
    activeWorktree = state.active;
    activeWorktreePaths = new Map(Object.entries(state.paths || {}));
    widgetHidden = state.widgetHidden ?? false;
  } catch {}
}

function buildWorktreeContext(): string {
  if (!worktreeMode && !activeWorktree) return "Worktree mode: OFF. No active worktree. Work in normal repo directories.";
  if (worktreeMode && !activeWorktree) return "Worktree mode: ON. No active worktree yet — create one before editing files.";
  const mappings = [...activeWorktreePaths.entries()]
    .map(([repo, path]) => `  ${repo} → ${path}`)
    .join("\n");
  return `Worktree mode: ON. Active worktree: "${activeWorktree}"\nRepo paths:\n${mappings}`;
}

export default function worktreeExtension(pi: ExtensionAPI): void {
  let uiCtx: any = null;
  let widgetRegistered = false;
  let sessionId = "";

  function getSessionId(ctx: any): string {
    const file = ctx.sessionManager?.getSessionFile?.() || "";
    return file ? basename(file, ".json") : `mem-${Date.now()}`;
  }

  pi.on("session_start", async (_e, ctx) => {
    sessionId = getSessionId(ctx);
    loadState(ctx.cwd, sessionId);
    if (activeWorktree) updateWidget(ctx);
  });

  function updateWidget(ctx: any): void {
    uiCtx = ctx;
    if (!activeWorktree || widgetHidden) {
      if (widgetRegistered) {
        ctx.ui.setWidget("pi-worktree", undefined);
        widgetRegistered = false;
      }
      return;
    }
    ctx.ui.setWidget("pi-worktree", (tui: any, theme: any) => ({
      render(width: number): string[] {
        const lines: string[] = [];
        const trunc = (s: string) => s.length > width ? s.slice(0, width - 1) + "…" : s;
        lines.push(trunc(` 🌳 Worktree: ${activeWorktree}`));
        for (const [repo] of activeWorktreePaths) {
          lines.push(trunc(`   ${repo}`));
        }
        return lines;
      },
      invalidate(): void { widgetRegistered = false; },
    }), { placement: "aboveEditor" });
    widgetRegistered = true;
  }

  pi.registerTool({
    name: "get_worktree_paths",
    label: "Worktree Paths",
    description: "Returns the active worktree paths mapping repos to their worktree directories. Call this to know where to read/write files when a worktree is active.",
    promptSnippet: "Get active worktree paths for file operations",
    promptGuidelines: [
      "Call `get_worktree_paths` before editing files. If it returns an active worktree, ALL reads/writes/edits MUST use those paths instead of the main repo.",
      "If `get_worktree_paths` says worktree mode is ON but no worktree is active, call `create_worktree` with the repos you intend to modify before making changes.",
      "If worktree mode is OFF and no worktree is active, work in the normal repo directories as usual.",
      "If a worktree is active but you need to edit a repo not yet in it, call `attach_worktree_repos` to add it instead of creating a new worktree.",
    ],
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: "text", text: buildWorktreeContext() }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "list_worktrees",
    label: "List Worktrees",
    description: "Lists all existing worktrees on disk across repos, grouped by repo, with each worktree's branch and whether it is the currently active one. Use to discover available worktrees before activating, attaching, or deleting one.",
    promptSnippet: "List all existing git worktrees across repos",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const repos = discoverRepos(ctx.cwd);
      const lines: string[] = [];
      const details: Array<{ repo: string; name: string; branch: string; path: string; active: boolean }> = [];

      for (const repo of repos) {
        const worktrees = getExistingWorktrees(repo);
        if (worktrees.length === 0) continue;
        lines.push(`${basename(repo)}:`);
        for (const wt of worktrees) {
          const isActive = activeWorktree === wt.name;
          lines.push(`  ${wt.name} → ${wt.branch}${isActive ? " (active)" : ""}`);
          details.push({ repo: basename(repo), name: wt.name, branch: wt.branch, path: wt.path, active: isActive });
        }
      }

      const text = lines.length > 0 ? lines.join("\n") : "No worktrees found.";
      return {
        content: [{ type: "text", text }],
        details: { worktrees: details },
      };
    },
  });

  pi.registerTool({
    name: "create_worktree",
    label: "Create Worktree",
    description: "Creates a new worktree for the specified repos and activates it. The worktree gets a random tree-themed name (from a fixed pool) and a new branch. All .env* files are symlinked into it. Do NOT pass a custom name — the name is always auto-generated.",
    promptSnippet: "Create and activate a git worktree for isolated work. Name is auto-assigned from a tree pool.",
    parameters: Type.Object({
      repos: Type.Array(Type.String(), { description: "Repo directory names to create worktrees in (e.g. ['api-arvore', 'frontend-arvore-nextjs'])" }),
      branch: Type.Optional(Type.String({ description: "Branch name (optional, defaults to wt/<name>)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const repos = discoverRepos(ctx.cwd);
      const targetRepos = repos.filter((r) => params.repos.includes(basename(r)));

      if (targetRepos.length === 0) {
        return { content: [{ type: "text", text: `No matching repos found. Available: ${repos.map((r) => basename(r)).join(", ")}` }], details: {} };
      }

      const name = pickAvailableName(targetRepos[0]) || "worktree";
      const results: string[] = [];

      activeWorktreePaths.clear();
      for (const repo of targetRepos) {
        const result = createWorktree(repo, name, params.branch);
        results.push(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
        if (result.ok) {
          activeWorktreePaths.set(basename(repo), join(repo, WORKTREES_DIR, name));
        }
      }

      if (activeWorktreePaths.size > 0) {
        activeWorktree = name;
        updateWidget(ctx);
        saveState(ctx.cwd, sessionId);
      }

      const context = buildWorktreeContext();
      return { content: [{ type: "text", text: results.join("\n") + "\n\n" + context }], details: {} };
    },
  });

  pi.registerTool({
    name: "stop_worktree",
    label: "Stop Worktree",
    description: "Deactivates the current worktree. Call this when you are done working in a worktree or the task is complete.",
    promptSnippet: "Deactivate the current worktree",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      if (!activeWorktree) {
        return { content: [{ type: "text", text: "No active worktree." }], details: {} };
      }
      const prev = activeWorktree;
      activeWorktree = null;
      activeWorktreePaths.clear();
      updateWidget(ctx);
      saveState(ctx.cwd, sessionId);
      return { content: [{ type: "text", text: `Deactivated worktree '${prev}'.` }], details: {} };
    },
  });

  pi.registerTool({
    name: "attach_worktree_repos",
    label: "Attach Repos",
    description: "Adds more repos to the currently active worktree. Use when you discover you need to edit additional repos that aren't yet part of the active worktree.",
    promptSnippet: "Attach additional repos to the active worktree",
    parameters: Type.Object({
      repos: Type.Array(Type.String(), { description: "Repo directory names to add (e.g. ['frontend-arvore-nextjs'])" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!activeWorktree) {
        return { content: [{ type: "text", text: "No active worktree. Call create_worktree first." }], details: {} };
      }

      const allRepos = discoverRepos(ctx.cwd);
      const targetRepos = allRepos.filter((r) => params.repos.includes(basename(r)) && !activeWorktreePaths.has(basename(r)));

      if (targetRepos.length === 0) {
        return { content: [{ type: "text", text: `No new repos to attach. Already active: ${[...activeWorktreePaths.keys()].join(", ")}` }], details: {} };
      }

      const results: string[] = [];
      for (const repo of targetRepos) {
        const result = createWorktree(repo, activeWorktree);
        if (result.ok) {
          activeWorktreePaths.set(basename(repo), join(repo, WORKTREES_DIR, activeWorktree));
          results.push(`✓ ${result.message}`);
        } else {
          results.push(`✗ ${result.message}`);
        }
      }

      updateWidget(ctx);
      saveState(ctx.cwd, sessionId);
      const context = buildWorktreeContext();
      return { content: [{ type: "text", text: results.join("\n") + "\n\n" + context }], details: {} };
    },
  });

  pi.registerTool({
    name: "detach_worktree_repos",
    label: "Detach Repos",
    description: "Removes repos from the active worktree tracking without deleting the worktree from disk.",
    promptSnippet: "Remove repos from the active worktree",
    parameters: Type.Object({
      repos: Type.Array(Type.String(), { description: "Repo directory names to remove (e.g. ['frontend-arvore-nextjs'])" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!activeWorktree) {
        return { content: [{ type: "text", text: "No active worktree." }], details: {} };
      }
      const removed: string[] = [];
      for (const repo of params.repos) {
        if (activeWorktreePaths.has(repo)) {
          activeWorktreePaths.delete(repo);
          removed.push(repo);
        }
      }
      if (removed.length === 0) {
        return { content: [{ type: "text", text: `None of those repos are in the active worktree. Active: ${[...activeWorktreePaths.keys()].join(", ")}` }], details: {} };
      }
      if (activeWorktreePaths.size === 0) {
        activeWorktree = null;
      }
      updateWidget(ctx);
      saveState(ctx.cwd, sessionId);
      return { content: [{ type: "text", text: `Detached: ${removed.join(", ")}\n\n${buildWorktreeContext()}` }], details: {} };
    },
  });

  pi.registerTool({
    name: "delete_worktree",
    label: "Delete Worktree",
    description: "Permanently removes worktree directories and their branches from disk. Use when work is done and the worktree is no longer needed.",
    promptSnippet: "Delete a worktree and its branches from disk",
    parameters: Type.Object({
      name: Type.String({ description: "Worktree name to delete (e.g. 'biografosa')" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const allRepos = discoverRepos(ctx.cwd);
      const results: string[] = [];

      for (const repo of allRepos) {
        const wtPath = join(repo, WORKTREES_DIR, params.name);
        if (!existsSync(wtPath)) continue;
        const result = removeWorktree(repo, params.name);
        results.push(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
        if (result.ok) {
          const branch = `wt/${params.name}`;
          spawnSync("git", ["branch", "-D", branch], { cwd: repo, encoding: "utf-8" });
        }
      }

      if (results.length === 0) {
        return { content: [{ type: "text", text: `Worktree '${params.name}' not found in any repo.` }], details: {} };
      }

      if (activeWorktree === params.name) {
        activeWorktree = null;
        activeWorktreePaths.clear();
        updateWidget(ctx);
        saveState(ctx.cwd, sessionId);
      }

      return { content: [{ type: "text", text: results.join("\n") }], details: {} };
    },
  });

  pi.registerCommand("worktree", {
    description: "Manage git worktrees with tree-themed names across repos",
    handler: async (args, ctx) => {
      const { command, flags } = parseArgs(args);

      const repos = discoverRepos(ctx.cwd);
      if (repos.length === 0) {
        ctx.ui.notify("No git repos found in workspace", "error");
        return;
      }

      const filterRepos = (repoList: string[]): string[] => {
        if (!flags.repos) return repoList;
        const selected = new Set(flags.repos.split(",").map((r) => r.trim()));
        return repoList.filter((r) => selected.has(basename(r)));
      };

      switch (command) {
        case "create": {
          let targetRepos = filterRepos(repos);

          if (!flags.repos && ctx.hasUI) {
            const repoNames = repos.map((r) => basename(r));
            const picked = await ctx.ui.custom<string[]>(
              (tui, theme, _keybindings, done) => {
                const selected = new Set<number>();
                let cursor = 0;
                let filter = "";

                const getFiltered = () => {
                  if (!filter) return repoNames.map((_, i) => i);
                  const lower = filter.toLowerCase();
                  return repoNames.reduce<number[]>((acc, name, i) => {
                    if (name.toLowerCase().includes(lower)) acc.push(i);
                    return acc;
                  }, []);
                };

                return {
                  render(width: number): string[] {
                    const lines: string[] = [];
                    lines.push(theme.bold(" Select repos (space=toggle, enter=confirm, esc=cancel, type to filter)"));
                    lines.push(` ${theme.fg("accent", "❯")} ${filter || theme.fg("dim", "type to filter...")}`)
                    lines.push("");
                    const visible = getFiltered();
                    for (let vi = 0; vi < visible.length; vi++) {
                      const i = visible[vi];
                      const marker = selected.has(i) ? theme.fg("accent", "●") : "○";
                      const pointer = vi === cursor ? theme.fg("accent", "❯ ") : "  ";
                      lines.push(`${pointer}${marker} ${repoNames[i]}`);
                    }
                    lines.push("");
                    lines.push(theme.fg("dim", ` ${selected.size} selected`));
                    return lines;
                  },
                  handleInput(data: string): void {
                    const visible = getFiltered();
                    if (data === "\x1B[A") cursor = Math.max(0, cursor - 1);
                    else if (data === "\x1B[B") cursor = Math.min(visible.length - 1, cursor + 1);
                    else if (data === " ") {
                      const i = visible[cursor];
                      if (i !== undefined) {
                        if (selected.has(i)) selected.delete(i);
                        else selected.add(i);
                      }
                    } else if (data === "\r" || data === "\n") {
                      done([...selected].map((i) => repos[i]));
                      return;
                    } else if (data === "\x1B" || data === "\x03") {
                      done([]);
                      return;
                    } else if (data === "\x7F" || data === "\b") {
                      filter = filter.slice(0, -1);
                      cursor = 0;
                    } else if (data.length === 1 && data >= " ") {
                      filter += data;
                      cursor = 0;
                    }
                    tui.requestRender();
                  },
                  invalidate(): void {},
                };
              },
              { overlay: true, overlayOptions: { anchor: "bottom-center", width: "100%", maxHeight: "85%" } },
            );

            if (!picked || picked.length === 0) {
              ctx.ui.notify("Cancelled", "warning");
              return;
            }
            targetRepos = picked;
          }

          const name = flags.name || pickAvailableName(targetRepos[0]) || "worktree";
          const results: string[] = [];

          activeWorktreePaths.clear();
          for (const repo of targetRepos) {
            const result = createWorktree(repo, name, flags.branch);
            results.push(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
            if (result.ok) {
              activeWorktreePaths.set(basename(repo), join(repo, WORKTREES_DIR, name));
            }
          }

          if (activeWorktreePaths.size > 0) {
            activeWorktree = name;
            updateWidget(ctx);
            saveState(ctx.cwd, sessionId);
          }

          ctx.ui.notify(results.join("\n"), "info");
          break;
        }

        case "list": {
          const targetRepos = filterRepos(repos);
          const lines: string[] = [];

          for (const repo of targetRepos) {
            const worktrees = getExistingWorktrees(repo);
            if (worktrees.length === 0) continue;
            lines.push(`${basename(repo)}:`);
            for (const wt of worktrees) {
              lines.push(`  ${wt.name} → ${wt.branch}`);
            }
          }

          if (lines.length === 0) {
            ctx.ui.notify("No worktrees found", "info");
          } else {
            ctx.ui.notify(lines.join("\n"), "info");
          }
          break;
        }

        case "use": {
          const name = flags._positional || flags.name;
          if (!name) {
            ctx.ui.notify("Usage: /worktree use <name>", "warning");
            return;
          }

          const targetRepos = filterRepos(repos);
          activeWorktreePaths.clear();

          for (const repo of targetRepos) {
            const wtPath = join(repo, WORKTREES_DIR, name);
            if (existsSync(wtPath) && existsSync(join(wtPath, ".git"))) {
              activeWorktreePaths.set(basename(repo), wtPath);
            }
          }

          if (activeWorktreePaths.size === 0) {
            ctx.ui.notify(`Worktree '${name}' not found in any repo`, "warning");
            return;
          }

          activeWorktree = name;
          updateWidget(ctx);
          saveState(ctx.cwd, sessionId);
          ctx.ui.notify(`Activated worktree '${name}' (${activeWorktreePaths.size} repos)`, "info");
          break;
        }

        case "stop": {
          if (!activeWorktree) {
            ctx.ui.notify("No active worktree", "warning");
            return;
          }
          const prev = activeWorktree;
          activeWorktree = null;
          activeWorktreePaths.clear();
          updateWidget(ctx);
          saveState(ctx.cwd, sessionId);
          ctx.ui.notify(`Deactivated worktree '${prev}'`, "info");
          break;
        }

        case "mode": {
          const value = flags._positional?.toLowerCase();
          if (value === "on") worktreeMode = true;
          else if (value === "off") {
            worktreeMode = false;
            activeWorktree = null;
            activeWorktreePaths.clear();
            updateWidget(ctx);
          } else {
            worktreeMode = !worktreeMode;
          }
          ctx.ui.notify(`Worktree mode: ${worktreeMode ? "ON" : "OFF"}`, "info");
          saveState(ctx.cwd, sessionId);
          break;
        }

        case "widget": {
          const value = flags._positional?.toLowerCase();
          if (value === "on" || value === "show") widgetHidden = false;
          else if (value === "off" || value === "hide") widgetHidden = true;
          else widgetHidden = !widgetHidden;
          updateWidget(ctx);
          saveState(ctx.cwd, sessionId);
          ctx.ui.notify(`Worktree widget: ${widgetHidden ? "hidden" : "visible"}`, "info");
          break;
        }

        case "shell": {
          if (!activeWorktree || activeWorktreePaths.size === 0) {
            ctx.ui.notify("No active worktree. Use /worktree use <name> first.", "warning");
            return;
          }

          const inHerdr = !!process.env.HERDR_ENV || !!process.env.HERDR_PANE_ID;
          const inTmux = !!process.env.TMUX;
          const inWarp = process.env.TERM_PROGRAM === "WarpTerminal" || !!process.env.WARP_IS_LOCAL_SHELL_SESSION;

          if (!inHerdr && !inTmux && !inWarp) {
            ctx.ui.notify("shell requires Herdr, tmux, or Warp Terminal.", "error");
            return;
          }

          const paths = [...activeWorktreePaths.values()];

          if (inHerdr) {
            const sourcePane = process.env.HERDR_PANE_ID;
            for (let i = 0; i < paths.length; i++) {
              const args = ["pane", "split", "--direction", i === 0 ? "right" : "down", "--cwd", paths[i], "--no-focus"];
              if (sourcePane) args.splice(2, 0, sourcePane);
              const result = spawnSync("herdr", args, { encoding: "utf-8" });
              if (result.status !== 0) {
                ctx.ui.notify(`herdr pane split failed: ${result.stderr?.trim() || result.error?.message || "unknown error"}`, "error");
                return;
              }
            }
          } else {
            for (let i = 0; i < paths.length; i++) {
              if (inTmux) {
                if (i === 0) {
                  spawn("tmux", ["split-window", "-h", "-c", paths[i]], { stdio: "ignore" });
                } else {
                  spawn("tmux", ["split-window", "-v", "-c", paths[i]], { stdio: "ignore" });
                }
              } else {
                const opener = process.platform === "darwin" ? "open" : "xdg-open";
                spawn(opener, [`warp://action/new_tab?path=${encodeURIComponent(paths[i])}`], { detached: true, stdio: "ignore" }).unref();
              }
            }
          }

          const repoNames = paths.map((p) => basename(p).replace(`.worktrees/${activeWorktree}`, basename(resolve(p, "../.."))));
          ctx.ui.notify(`Opened shell in: ${[...activeWorktreePaths.keys()].slice(0, paths.length).join(", ")}`, "info");
          break;
        }

        case "delete": {
          const name = flags._positional || flags.name;
          if (!name) {
            ctx.ui.notify("Usage: /worktree delete <name> [--repos repo1,repo2]", "warning");
            return;
          }

          const targetRepos = filterRepos(repos);
          const results: string[] = [];

          for (const repo of targetRepos) {
            if (!existsSync(join(repo, WORKTREES_DIR, name))) continue;
            const result = removeWorktree(repo, name);
            results.push(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
          }

          if (results.length === 0) {
            ctx.ui.notify(`Worktree '${name}' not found in any repo`, "warning");
          } else {
            ctx.ui.notify(results.join("\n"), "info");
          }
          break;
        }

        case "clean": {
          const targetRepos = filterRepos(repos);
          const exclude = new Set<string>(activeWorktree ? [activeWorktree] : []);
          const dryRun = flags.dry !== undefined || flags["dry-run"] !== undefined;
          const bumpKind = (["major", "minor", "patch"].includes(flags.bump) ? flags.bump : "patch") as "major" | "minor" | "patch";
          const skipPr = flags["no-pr"] !== undefined;
          const assumeYes = flags.yes !== undefined || flags.y !== undefined;
          const STATUS_KEY = "worktree-clean";
          const step = (text: string) => ctx.ui.setStatus(STATUS_KEY, text);
          const clearStep = () => ctx.ui.setStatus(STATUS_KEY, undefined);

          ctx.ui.notify("Scanning for merged worktrees…", "info");

          step("worktree clean: scanning for merged worktrees…");
          const removedByRepo: Array<{ repo: string; name: string; branch: string; path: string }> = [];
          for (const repo of targetRepos) {
            step(`worktree clean: scanning ${basename(repo)}…`);
            const merged = findMergedWorktrees(repo, exclude);
            for (const wt of merged) {
              removedByRepo.push({ repo, name: wt.name, branch: wt.branch, path: wt.path });
            }
          }

          if (removedByRepo.length === 0) {
            clearStep();
            ctx.ui.notify("No merged worktrees to clean.", "info");
            break;
          }

          step("worktree clean: inspecting worktrees…");
          const plan = removedByRepo.map((r) => {
            const dirty = isWorktreeDirty(r.path);
            const procs = findProcessesUsingDir(r.path);
            return { ...r, dirty, procs };
          });
          clearStep();

          const planLines = plan.map((p) => {
            const flagsTxt: string[] = [];
            if (p.dirty) flagsTxt.push("⚠ uncommitted changes");
            if (p.procs.length > 0) flagsTxt.push(`⚠ ${p.procs.length} running process(es)`);
            const suffix = flagsTxt.length ? `  [${flagsTxt.join(", ")}]` : "";
            return `  ${basename(p.repo)}/${p.name} (${p.branch})${suffix}`;
          });
          const procDetails = plan
            .filter((p) => p.procs.length > 0)
            .map((p) => `  ${basename(p.repo)}/${p.name}:\n${p.procs.map((proc) => `    [${proc.pid}] ${proc.command}`).join("\n")}`)
            .join("\n");
          const anyDirty = plan.some((p) => p.dirty);
          const anyProcs = plan.some((p) => p.procs.length > 0);

          if (dryRun) {
            const preview = planLines.join("\n");
            ctx.ui.notify(`Would remove ${removedByRepo.length} merged worktree(s):\n${preview}`, "info");
            break;
          }

          if (!assumeYes && ctx.hasUI) {
            let message = `The following ${plan.length} merged worktree(s) will be removed:\n\n${planLines.join("\n")}`;
            if (anyProcs) {
              message += `\n\nRunning processes will be killed before removal:\n${procDetails}`;
            }
            if (anyDirty) {
              message += `\n\n⚠ Some worktrees have uncommitted changes that will be DISCARDED (--force).`;
            }
            message += `\n\nLocal branches will be deleted and @arvoretech/pi-worktree bumped (${bumpKind}).`;
            const confirmed = await ctx.ui.confirm("worktree clean", message);
            if (!confirmed) {
              ctx.ui.notify("worktree clean: cancelled.", "warning");
              break;
            }
          }

          const results: string[] = [];
          for (const { repo, name, branch, path, procs } of plan) {
            if (procs.length > 0) {
              step(`worktree clean: killing ${procs.length} process(es) in ${name}…`);
              killProcesses(procs.map((proc) => proc.pid));
              results.push(`• Killed ${procs.length} process(es) holding ${basename(repo)}/${name}`);
            }
            const stillUsed = findProcessesUsingDir(path);
            if (stillUsed.length > 0) {
              results.push(`✗ ${basename(repo)}/${name}: ${stillUsed.length} process(es) still using the dir — skipped`);
              continue;
            }
            step(`worktree clean: removing ${basename(repo)}/${name}…`);
            const result = removeWorktree(repo, name);
            results.push(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
            if (result.ok) {
              spawnSync("git", ["branch", "-D", branch], { cwd: repo, encoding: "utf-8" });
            }
          }

          const piRepo = repos.find((r) => basename(r) === "arvore-pi-extensions");
          if (!piRepo) {
            clearStep();
            ctx.ui.notify(results.join("\n") + "\n\narvore-pi-extensions repo not found — skipped version bump/PR.", "warning");
            break;
          }

          step("worktree clean: bumping version…");
          const pkgPath = join(piRepo, "packages", "worktree", "package.json");
          const bumped = bumpPackageVersion(pkgPath, bumpKind);
          if (!bumped) {
            clearStep();
            ctx.ui.notify(results.join("\n") + `\n\nCould not read ${pkgPath} — skipped version bump/PR.`, "warning");
            break;
          }
          results.push(`✓ Bumped @arvoretech/pi-worktree ${bumped.from} → ${bumped.to}`);

          if (skipPr) {
            clearStep();
            ctx.ui.notify(results.join("\n") + "\n\n--no-pr set: version bumped locally, no commit/PR created.", "info");
            break;
          }

          const branchName = `worktree-clean/bump-${bumped.to}`;
          const removedList = removedByRepo
            .map((r) => `- ${basename(r.repo)}/${r.name} (${r.branch})`)
            .join("\n");
          const prTitle = `chore(worktree): clean merged worktrees, bump to ${bumped.to}`;
          const prBody = `## Summary\n\nRemoved merged worktrees and bumped \`@arvoretech/pi-worktree\` to \`${bumped.to}\`.\n\n### Removed worktrees\n${removedList}\n\n_Automated by \`/worktree clean\`._`;

          const git = (args: string[]) => spawnSync("git", args, { cwd: piRepo, encoding: "utf-8" });

          const dirty = git(["status", "--porcelain"]).stdout?.trim() || "";
          const onlyPkgDirty = dirty.split("\n").every((l) => l === "" || l.endsWith("packages/worktree/package.json"));
          if (!onlyPkgDirty) {
            clearStep();
            ctx.ui.notify(
              results.join("\n") +
                "\n\narvore-pi-extensions has uncommitted changes — version bumped locally, but skipped branch/commit/PR to avoid touching your work. Commit or stash, then re-run.",
              "warning",
            );
            break;
          }

          const baseBranch = getDefaultBranch(piRepo) || getCurrentBranch(piRepo);
          step(`worktree clean: creating branch ${branchName}…`);
          git(["checkout", "-b", branchName]);
          git(["add", pkgPath]);
          step("worktree clean: committing…");
          const commit = git(["commit", "-m", prTitle]);
          if (commit.status !== 0) {
            clearStep();
            ctx.ui.notify(results.join("\n") + `\n\nCommit failed: ${commit.stderr?.trim()}`, "error");
            break;
          }
          step(`worktree clean: pushing ${branchName}…`);
          const push = git(["push", "-u", "origin", branchName]);
          if (push.status !== 0) {
            clearStep();
            ctx.ui.notify(results.join("\n") + `\n\nPush failed: ${push.stderr?.trim()}`, "error");
            break;
          }

          step("worktree clean: opening PR…");
          const pr = spawnSync(
            "gh",
            ["pr", "create", "--title", prTitle, "--body", prBody, "--base", baseBranch, "--head", branchName],
            { cwd: piRepo, encoding: "utf-8" },
          );
          if (pr.status !== 0) {
            clearStep();
            ctx.ui.notify(results.join("\n") + `\n\nBranch pushed, but PR creation failed: ${pr.stderr?.trim()}`, "warning");
            break;
          }
          const prUrl = (pr.stdout || "").trim();
          results.push(`✓ Opened PR: ${prUrl}`);
          clearStep();
          ctx.ui.notify(results.join("\n"), "info");
          break;
        }

        default:
          ctx.ui.notify(formatHelp(), "info");
      }
    },
  });
}
