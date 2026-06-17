import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { execSync, spawnSync, spawn } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, readdirSync, statSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";

let activeWorktree: string | null = null;
let activeWorktreePaths: Map<string, string> = new Map();
let worktreeMode = true;

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

function symlinkEnvFiles(repoPath: string, targetDir: string): void {
  for (const entry of readdirSync(repoPath)) {
    if (!entry.startsWith(".env")) continue;
    const src = join(repoPath, entry);
    const dest = join(targetDir, entry);
    if (statSync(src).isFile() && !existsSync(dest)) {
      try { symlinkSync(src, dest); } catch (e) {
        process.stderr.write(`[pi-worktree] Failed to symlink ${entry}: ${(e as Error).message}\n`);
      }
    }
  }
  if (existsSync(join(repoPath, "package.json")) && !existsSync(join(targetDir, "node_modules"))) {
    const pm = existsSync(join(repoPath, "pnpm-lock.yaml")) ? "pnpm" : existsSync(join(repoPath, "yarn.lock")) ? "yarn" : "npm";
    spawn(pm, ["install"], { cwd: targetDir, stdio: "ignore", detached: true }).unref();
  }
}

function createWorktree(repoPath: string, name: string, branch?: string): { ok: boolean; message: string } {
  const targetDir = join(repoPath, WORKTREES_DIR, name);
  if (existsSync(targetDir)) return { ok: false, message: `Worktree '${name}' already exists in ${basename(repoPath)}` };

  ensureGitignore(repoPath);

  const branchFlag = branch ? ["-b", branch] : ["-b", `wt/${name}`];
  const result = spawnSync("git", ["worktree", "add", ...branchFlag, targetDir], {
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
      symlinkEnvFiles(repoPath, targetDir);
      return { ok: true, message: `Created worktree '${name}' in ${basename(repoPath)} (existing branch)` };
    }
    return { ok: false, message: `Failed: ${err}` };
  }

  symlinkEnvFiles(repoPath, targetDir);
  return { ok: true, message: `Created worktree '${name}' in ${basename(repoPath)} → branch wt/${name}` };
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

function formatHelp(): string {
  return [
    "Usage: /worktree <command> [options]",
    "",
    "Commands:",
    "  create [--repos repo1,repo2] [--name slug] [--branch name]",
    "  use    <name>     — activate worktree (agent works in worktree paths)",
    "  stop              — deactivate current worktree",
    "  mode   [on|off]   — toggle worktree mode (agent auto-creates worktrees)",
    "  hub               — interactive dashboard: list worktrees, PR status, view diffs",
    "  shell [--all]     — open tmux pane or Warp tab in the worktree (tmux/Warp only)",
    "  list   [--repos repo1,repo2]",
    "  delete <name> [--repos repo1,repo2]",
    "",
    "If --repos is omitted, shows interactive picker.",
    "If --name is omitted on create, picks a random tree name.",
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
}

function getStatePath(cwd: string, sessionId: string): string | null {
  const root = findHubRoot(cwd);
  return root ? join(root, STATE_DIR, `${sessionId}.json`) : null;
}

function saveState(cwd: string, sessionId: string): void {
  const path = getStatePath(cwd, sessionId);
  if (!path) return;
  const state: WorktreeState = { mode: worktreeMode, active: activeWorktree, paths: Object.fromEntries(activeWorktreePaths) };
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
    if (!activeWorktree) {
      if (widgetRegistered) {
        ctx.ui.setWidget("pi-worktree", undefined);
        widgetRegistered = false;
      }
      return;
    }
    ctx.ui.setWidget("pi-worktree", (tui: any, theme: any) => ({
      render(width: number): string[] {
        const lines: string[] = [];
        lines.push(theme.bold(` 🌳 Worktree: ${activeWorktree}`));
        for (const [repo, path] of activeWorktreePaths) {
          lines.push(theme.fg("dim", `   ${repo} → ${path}`));
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

        case "diff":
        case "hub": {
          if (!ctx.hasUI) {
            ctx.ui.notify("Requires interactive mode", "error");
            return;
          }

          interface WtInfo {
            name: string;
            branch: string;
            repos: Array<{ name: string; path: string; pr: { url: string; state: string; number: number } | null }>;
          }

          const allWorktrees = new Map<string, WtInfo>();

          for (const repo of repos) {
            const wts = getExistingWorktrees(repo);
            for (const wt of wts) {
              if (!allWorktrees.has(wt.name)) {
                allWorktrees.set(wt.name, { name: wt.name, branch: wt.branch, repos: [] });
              }
              const info = allWorktrees.get(wt.name)!;
              info.repos.push({ name: basename(repo), path: wt.path, pr: null });
            }
          }

          const wtList = [...allWorktrees.values()];

          for (const wt of wtList) {
            for (const r of wt.repos) {
              const prResult = spawnSync("gh", ["pr", "list", "--head", wt.branch, "--state", "all", "--json", "number,state,url", "--limit", "1"], {
                cwd: r.path, encoding: "utf-8",
              });
              if (prResult.status === 0 && prResult.stdout?.trim()) {
                try {
                  const prs = JSON.parse(prResult.stdout);
                  if (prs.length > 0) r.pr = prs[0];
                } catch {}
              }
            }
          }

          if (wtList.length === 0) {
            ctx.ui.notify("No worktrees found.", "info");
            return;
          }

          const pager = process.env.GIT_PAGER || spawnSync("git", ["config", "core.pager"], { encoding: "utf-8" }).stdout?.trim() || "";
          const pagerBase = pager.split(/\s+/)[0];
          const pagerArgs = pager.split(/\s+/).slice(1).filter((a) => a !== "--paging=never");
          if (pagerBase === "delta" || pagerBase.endsWith("/delta")) {
            const cols = Math.floor((process.stdout.columns || 200) * 0.9) - 4;
            pagerArgs.push("--paging=never", `--width=${cols}`);
          }

          const stripAnsi = (s: string) => s.replace(/\x1B(?:\[[\d;]*[A-Za-z]|\].*?(?:\x07|\x1B\\)|\([A-Z]|\[[\d;]*m)/g, "").replace(/[\x00-\x09\x0B-\x1F]/g, "");
          const visLen = (s: string) => stripAnsi(s).length;
          const truncAnsi = (s: string, max: number): string => {
            let vis = 0;
            let i = 0;
            while (i < s.length && vis < max) {
              if (s[i] === "\x1B") {
                const m = s.slice(i).match(/^\x1B(?:\[[\d;]*[A-Za-z]|\].*?(?:\x07|\x1B\\)|\([A-Z]|\[[\d;]*m)/);
                if (m) { i += m[0].length; continue; }
              }
              vis++;
              i++;
            }
            return s.slice(0, i);
          };

          type View = "list" | "diff";
          let view: View = "list";
          let cursor = 0;
          let diffLines: Array<{ repo: string; lines: string[] }> = [];
          let diffRepo = 0;
          let scrollOffset = 0;

          function loadDiff(wt: WtInfo): void {
            diffLines = [];
            for (const r of wt.repos) {
              const raw = spawnSync("git", ["diff"], { cwd: r.path, encoding: "utf-8" }).stdout?.trim() || "";
              let rendered = raw;
              if (raw && pagerBase) {
                const piped = spawnSync(pagerBase, pagerArgs, { cwd: r.path, encoding: "utf-8", input: raw });
                if (piped.status === 0 && piped.stdout) rendered = piped.stdout;
              }
              const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: r.path, encoding: "utf-8" }).stdout?.trim() || "";
              const parts = [rendered, untracked ? `Untracked:\n${untracked}` : ""].filter(Boolean).join("\n\n");
              diffLines.push({ repo: r.name, lines: (parts || "(no changes)").split("\n") });
            }
            diffRepo = 0;
            scrollOffset = 0;
          }

          await ctx.ui.custom(
            (tui, theme, _keybindings, done) => {
              return {
                render(width: number): string[] {
                  const maxH = Math.floor((tui.terminal?.rows || 40) * 0.75);
                  const innerW = width - 2;
                  const contentW = innerW - 2;
                  const pad = (s: string) => {
                    const t = truncAnsi(s, contentW);
                    const gap = Math.max(0, contentW - visLen(t));
                    return `│ ${t}${" ".repeat(gap)} │`;
                  };
                  const emptyRow = `│${" ".repeat(innerW)}│`;

                  if (view === "list") {
                    const title = `─ Worktree Hub `;
                    const topBorder = `┌${title}${"─".repeat(Math.max(0, innerW - title.length))}┐`;
                    const bottomHint = ` ↑↓=navigate  enter=view diff  q=close `;
                    const bottomBorder = `└${bottomHint}${"─".repeat(Math.max(0, innerW - bottomHint.length))}┘`;

                    const output: string[] = [];
                    output.push(topBorder);
                    output.push(pad(theme.bold("Worktrees")));
                    output.push(emptyRow);

                    for (let i = 0; i < wtList.length; i++) {
                      const wt = wtList[i];
                      const pointer = i === cursor ? theme.fg("accent", "❯") : " ";
                      const active = wt.name === activeWorktree ? theme.fg("accent", " ●") : "  ";
                      output.push(pad(`${pointer}${active} ${theme.bold(wt.name)} → ${wt.branch}`));
                      for (const r of wt.repos) {
                        let prStatus = theme.fg("dim", "no PR");
                        if (r.pr) {
                          if (r.pr.state === "MERGED") prStatus = theme.fg("accent", `✔ merged #${r.pr.number}`);
                          else if (r.pr.state === "CLOSED") prStatus = theme.fg("error", `✖ closed #${r.pr.number}`);
                          else prStatus = theme.fg("warning", `○ open #${r.pr.number}`);
                        }
                        output.push(pad(`     ${theme.fg("dim", r.name)}  ${prStatus}`));
                      }
                    }

                    const usedRows = wtList.reduce((acc, wt) => acc + 1 + wt.repos.length, 0);
                    const remaining = maxH - 5 - usedRows;
                    for (let i = 0; i < remaining && i < maxH; i++) output.push(emptyRow);

                    output.push(bottomBorder);
                    return output;
                  }

                  const selectedWt = wtList[cursor];
                  const title = `─ ${selectedWt.name}: diff `;
                  const topBorder = `┌${title}${"─".repeat(Math.max(0, innerW - title.length))}┐`;
                  const bottomHint = ` tab=repo  ↑↓=scroll  esc=back  q=close `;
                  const bottomBorder = `└${bottomHint}${"─".repeat(Math.max(0, innerW - bottomHint.length))}┘`;

                  const output: string[] = [];
                  output.push(topBorder);

                  const tabs = diffLines.map((d, i) =>
                    i === diffRepo ? theme.fg("accent", `[● ${d.repo}]`) : theme.fg("dim", `  ${d.repo} `)
                  ).join("  ");
                  output.push(pad(tabs));
                  output.push(emptyRow);

                  const contentH = maxH - 6;
                  const visible = diffLines[diffRepo]?.lines.slice(scrollOffset, scrollOffset + contentH) || [];

                  for (const line of visible) {
                    output.push(pad(line));
                  }

                  const remaining = contentH - visible.length;
                  for (let i = 0; i < remaining; i++) output.push(emptyRow);

                  output.push(emptyRow);
                  const totalLines = diffLines[diffRepo]?.lines.length || 0;
                  output.push(pad(theme.fg("dim", `[${scrollOffset + 1}-${Math.min(scrollOffset + contentH, totalLines)}/${totalLines}]`)));
                  output.push(bottomBorder);

                  return output;
                },
                handleInput(data: string): void {
                  const maxH = Math.floor((tui.terminal?.rows || 40) * 0.75);

                  if (view === "list") {
                    if (data === "\x1B[A" || data === "k") cursor = Math.max(0, cursor - 1);
                    else if (data === "\x1B[B" || data === "j") cursor = Math.min(wtList.length - 1, cursor + 1);
                    else if (data === "\r" || data === "\n") {
                      loadDiff(wtList[cursor]);
                      view = "diff";
                    }
                    else if (data === "q" || data === "\x03") { done(undefined); return; }
                  } else {
                    const contentH = maxH - 6;
                    const totalLines = diffLines[diffRepo]?.lines.length || 0;
                    if (data === "\x1B[A" || data === "k") scrollOffset = Math.max(0, scrollOffset - 1);
                    else if (data === "\x1B[B" || data === "j") scrollOffset = Math.min(Math.max(0, totalLines - contentH), scrollOffset + 1);
                    else if (data === "\x1B[5~") scrollOffset = Math.max(0, scrollOffset - contentH);
                    else if (data === "\x1B[6~") scrollOffset = Math.min(Math.max(0, totalLines - contentH), scrollOffset + contentH);
                    else if (data === "\t") { diffRepo = (diffRepo + 1) % diffLines.length; scrollOffset = 0; }
                    else if (data === "\x1B[Z") { diffRepo = (diffRepo - 1 + diffLines.length) % diffLines.length; scrollOffset = 0; }
                    else if (data === "\x1B" || data === "\b") { view = "list"; }
                    else if (data === "q" || data === "\x03") { done(undefined); return; }
                  }
                  tui.requestRender();
                },
                invalidate(): void {},
              };
            },
            { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "90%" } },
          );
          break;
        }

        case "shell": {
          if (!activeWorktree || activeWorktreePaths.size === 0) {
            ctx.ui.notify("No active worktree. Use /worktree use <name> first.", "warning");
            return;
          }

          const inTmux = !!process.env.TMUX;
          const inWarp = process.env.TERM_PROGRAM === "WarpTerminal" || !!process.env.WARP_IS_LOCAL_SHELL_SESSION;

          if (!inTmux && !inWarp) {
            ctx.ui.notify("shell requires tmux or Warp Terminal.", "error");
            return;
          }

          const paths = flags.all ? [...activeWorktreePaths.values()] : [activeWorktreePaths.values().next().value!];

          for (const wtPath of paths) {
            if (inTmux) {
              spawn("tmux", ["split-window", "-h", "-c", wtPath], { stdio: "ignore" });
            } else {
              spawn("open", [`warp://action/new_tab?path=${encodeURIComponent(wtPath)}`], { detached: true, stdio: "ignore" }).unref();
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

        default:
          ctx.ui.notify(formatHelp(), "info");
      }
    },
  });
}
