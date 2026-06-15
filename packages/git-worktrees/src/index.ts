import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";

const STATUS_KEY = "git-worktrees";
const EXEC_TIMEOUT_MS = 5000;

interface Worktree {
  path: string;
  branch?: string;
  head?: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
}

function shortBranch(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  return ref.replace(/^refs\/heads\//, "");
}

function parseWorktrees(porcelain: string): Worktree[] {
  const worktrees: Worktree[] = [];
  let current: Partial<Worktree> | null = null;

  const flush = () => {
    if (current?.path) {
      worktrees.push({
        path: current.path,
        branch: current.branch,
        head: current.head,
        bare: current.bare ?? false,
        detached: current.detached ?? false,
        locked: current.locked ?? false,
      });
    }
    current = null;
  };

  for (const rawLine of porcelain.split("\n")) {
    const line = rawLine.trimEnd();
    if (line === "") {
      flush();
      continue;
    }
    const spaceIndex = line.indexOf(" ");
    const key = spaceIndex === -1 ? line : line.slice(0, spaceIndex);
    const value = spaceIndex === -1 ? "" : line.slice(spaceIndex + 1);

    switch (key) {
      case "worktree":
        flush();
        current = { path: value };
        break;
      case "HEAD":
        if (current) current.head = value;
        break;
      case "branch":
        if (current) current.branch = shortBranch(value);
        break;
      case "bare":
        if (current) current.bare = true;
        break;
      case "detached":
        if (current) current.detached = true;
        break;
      case "locked":
        if (current) current.locked = true;
        break;
    }
  }
  flush();
  return worktrees;
}

function worktreeLabel(worktree: Worktree): string {
  if (worktree.bare) return "(bare)";
  if (worktree.branch) return worktree.branch;
  if (worktree.detached && worktree.head) return `detached @ ${worktree.head.slice(0, 7)}`;
  return "(unknown)";
}

function isCurrent(worktree: Worktree, cwd: string): boolean {
  const normalized = cwd.replace(/\/+$/, "");
  const wt = worktree.path.replace(/\/+$/, "");
  return normalized === wt || normalized.startsWith(`${wt}/`);
}

function findCurrent(worktrees: Worktree[], cwd: string): Worktree | undefined {
  const matches = worktrees.filter((w) => isCurrent(w, cwd));
  if (matches.length === 0) return undefined;
  return matches.reduce((best, w) => (w.path.length > best.path.length ? w : best));
}

export default function gitWorktrees(pi: ExtensionAPI): void {
  async function listWorktrees(cwd: string): Promise<Worktree[]> {
    const result = await pi.exec("git", ["worktree", "list", "--porcelain"], {
      cwd,
      timeout: EXEC_TIMEOUT_MS,
    });
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `git exited with code ${result.code}`);
    }
    return parseWorktrees(result.stdout);
  }

  async function refreshStatus(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) return;
    let worktrees: Worktree[];
    try {
      worktrees = await listWorktrees(ctx.cwd);
    } catch {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    if (worktrees.length === 0) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    const current = findCurrent(worktrees, ctx.cwd);
    const label = current ? worktreeLabel(current) : "detached";
    const count = worktrees.length;
    const suffix = count > 1 ? ` (${count} worktrees)` : "";
    ctx.ui.setStatus(STATUS_KEY, `🌿 ${label}${suffix}`);
  }

  pi.on("session_start", async (_event, ctx) => {
    await refreshStatus(ctx);
  });

  pi.registerCommand("worktrees", {
    description: "List git worktrees and show the one you are working in",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      let worktrees: Worktree[];
      try {
        worktrees = await listWorktrees(ctx.cwd);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to list worktrees: ${message}`, "error");
        return;
      }

      if (worktrees.length === 0) {
        ctx.ui.notify("No git worktrees found (not a git repository?).", "warning");
        return;
      }

      const current = findCurrent(worktrees, ctx.cwd);

      if (!ctx.hasUI) {
        const lines = worktrees.map((w) => {
          const marker = current && w.path === current.path ? "* " : "  ";
          return `${marker}${worktreeLabel(w)}\t${w.path}`;
        });
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      const items = worktrees.map((w) => {
        const marker = current && w.path === current.path ? "● " : "○ ";
        const flags = [
          w.locked ? "locked" : null,
          current && w.path === current.path ? "current" : null,
        ]
          .filter(Boolean)
          .join(", ");
        const suffix = flags ? `  [${flags}]` : "";
        return `${marker}${worktreeLabel(w)}  —  ${w.path}${suffix}`;
      });

      const choice = await ctx.ui.select("Git worktrees", items);
      if (choice === undefined) return;

      const index = items.indexOf(choice);
      const selected = worktrees[index];
      if (!selected) return;

      if (current && selected.path === current.path) {
        ctx.ui.notify(`Already in ${worktreeLabel(selected)} (${selected.path}).`, "info");
        await refreshStatus(ctx);
        return;
      }

      const action = await ctx.ui.select(
        `${worktreeLabel(selected)} — ${selected.path}`,
        ["Open in $EDITOR", "Copy cd command to clipboard", "Cancel"],
      );
      if (action === undefined || action === "Cancel") return;

      if (action === "Open in $EDITOR") {
        const editor = process.env.EDITOR || "code";
        try {
          spawn(editor, [selected.path], { detached: true, stdio: "ignore" }).unref();
          ctx.ui.notify(`Opened ${selected.path} in ${editor}.`, "info");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Failed to open editor: ${message}`, "error");
        }
        return;
      }

      const command = `cd ${quotePath(selected.path)}`;
      const copied = await copyToClipboard(command);
      if (copied) {
        ctx.ui.notify(`Copied to clipboard: ${command}`, "info");
      } else {
        ctx.ui.notify(command, "info");
      }
    },
  });
}

function quotePath(path: string): string {
  if (/^[\w./@%+:-]+$/.test(path)) return path;
  return `'${path.replace(/'/g, "'\\''")}'`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  const candidates: Array<{ command: string; args: string[] }> = [
    { command: "pbcopy", args: [] },
    { command: "wl-copy", args: [] },
    { command: "xclip", args: ["-selection", "clipboard"] },
    { command: "xsel", args: ["--clipboard", "--input"] },
  ];
  for (const { command, args } of candidates) {
    const ok = await new Promise<boolean>((resolve) => {
      try {
        const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
        child.on("error", () => resolve(false));
        child.on("exit", (code) => resolve(code === 0));
        child.stdin?.on("error", () => resolve(false));
        child.stdin?.end(text);
      } catch {
        resolve(false);
      }
    });
    if (ok) return true;
  }
  return false;
}
