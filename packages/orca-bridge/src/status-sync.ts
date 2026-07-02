import { runOrca, isOrcaSession, orcaCurrentWorktree } from "./core.js";

interface TodoItem {
  id: number;
  subject?: string;
  status?: string;
  activeForm?: string;
}

let lastComment = "";
let lastStatus = "";
let syncEnabled = true;

export function setStatusSyncEnabled(v: boolean): void {
  syncEnabled = v;
}

export function isStatusSyncEnabled(): boolean {
  return syncEnabled;
}

function extractTodos(result: any): TodoItem[] {
  const candidates = [result?.details?.tasks, result?.details?.todos, result?.tasks, result?.todos];
  for (const c of candidates) {
    if (Array.isArray(c)) return c as TodoItem[];
  }
  return [];
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

function buildCommentFromTodos(todos: TodoItem[]): { comment: string; status: string } | null {
  if (todos.length === 0) return null;
  const active = todos.find((t) => t.status === "in_progress");
  const completed = todos.filter((t) => t.status === "completed").length;
  const total = todos.length;

  let comment: string;
  let status: string;

  if (active) {
    const label = active.activeForm || active.subject || `task #${active.id}`;
    comment = `\ud83e\udd16 ${label} (${completed}/${total})`;
    status = "in-progress";
  } else if (completed === total) {
    comment = `\u2705 All ${total} tasks done`;
    status = "in-review";
  } else {
    comment = `\u23f8 ${completed}/${total} tasks done, none active`;
    status = "in-progress";
  }

  return { comment: truncate(comment, 120), status };
}

function buildCommentFromGoal(result: any): { comment: string; status: string } | null {
  const goal = result?.details?.goal || result?.goal;
  if (!goal) return null;
  const objective: string = goal.objective || goal.description || "";
  const goalStatus: string = goal.status || "";
  if (!objective) return null;
  const done = goalStatus === "complete" || goalStatus === "completed";
  return {
    comment: truncate(`${done ? "\u2705" : "\ud83c\udfaf"} ${objective}`, 120),
    status: done ? "in-review" : "in-progress",
  };
}

function pushToOrca(cwd: string, comment: string, status: string): void {
  const wt = orcaCurrentWorktree(cwd);
  if (!wt || wt.isMainWorktree) return;
  const selector = `id:${wt.id}`;

  if (comment !== lastComment) {
    const r = runOrca(["worktree", "set", "--worktree", selector, "--comment", comment]);
    if (r.ok) lastComment = comment;
  }
  if (status && status !== lastStatus) {
    const r = runOrca(["worktree", "set", "--worktree", selector, "--workspace-status", status]);
    if (r.ok) lastStatus = status;
  }
}

export function syncStatusFromTool(toolName: string, result: any, cwd: string): void {
  if (!syncEnabled || !isOrcaSession()) return;

  let derived: { comment: string; status: string } | null = null;
  if (toolName === "todo") derived = buildCommentFromTodos(extractTodos(result));
  else if (toolName === "create_goal" || toolName === "update_goal") derived = buildCommentFromGoal(result);

  if (derived) pushToOrca(cwd, derived.comment, derived.status);
}

export function pushManualStatus(cwd: string, comment: string, status?: string): { ok: boolean; message: string } {
  if (!isOrcaSession()) return { ok: false, message: "Not running inside an Orca session" };
  const wt = orcaCurrentWorktree(cwd);
  if (!wt || wt.isMainWorktree) return { ok: false, message: "No active non-main Orca worktree for the current directory" };
  const selector = `id:${wt.id}`;

  const args = ["worktree", "set", "--worktree", selector, "--comment", comment];
  if (status) args.push("--workspace-status", status);
  const r = runOrca(args);
  if (!r.ok) return { ok: false, message: `Orca set failed: ${r.error || "unknown error"}` };
  lastComment = comment;
  if (status) lastStatus = status;
  return { ok: true, message: `Updated Orca card${status ? ` (${status})` : ""}: ${comment}` };
}
