import { spawnSync } from "node:child_process";
import { resolve, basename } from "node:path";

let orcaAvailability: boolean | null = null;

export function orcaBinary(): string {
  return process.env.ORCA_CLI_BIN || (process.platform === "linux" ? "orca-ide" : "orca");
}

export function hasBinary(bin: string): boolean {
  const result = spawnSync(bin, ["--version"], { encoding: "utf-8", stdio: ["ignore", "ignore", "ignore"] });
  return !result.error;
}

export function isOrcaSession(): boolean {
  if (!process.env.ORCA_WORKTREE_ID) return false;
  if (orcaAvailability === null) orcaAvailability = hasBinary(orcaBinary());
  return orcaAvailability;
}

export interface OrcaResult<T = any> {
  ok: boolean;
  result?: T;
  error?: string;
}

export function runOrca<T = any>(args: string[], timeoutMs = 30000, cwd?: string): OrcaResult<T> {
  const result = spawnSync(orcaBinary(), [...args, "--json"], { encoding: "utf-8", timeout: timeoutMs, cwd });
  if (result.error) {
    const isTimeout = (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
    return { ok: false, error: isTimeout ? `orca ${args[0]} timed out after ${timeoutMs}ms` : result.error.message };
  }
  const raw = (result.stdout || "").trim();
  if (!raw) {
    return { ok: result.status === 0, error: result.stderr?.trim() || `orca ${args.join(" ")} produced no output` };
  }
  try {
    const parsed = JSON.parse(raw) as { ok?: boolean; result?: T; error?: any };
    if (parsed.ok === false) {
      const err = typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error);
      return { ok: false, error: err || "orca reported failure" };
    }
    return { ok: true, result: parsed.result as T };
  } catch {
    return { ok: result.status === 0, error: result.status === 0 ? undefined : raw };
  }
}

export interface OrcaWorktreeInfo {
  id: string;
  path: string;
  displayName?: string;
  branch?: string;
  isMainWorktree?: boolean;
}

export function orcaCurrentWorktree(cwd?: string): OrcaWorktreeInfo | null {
  const current = runOrca<{ worktree?: OrcaWorktreeInfo }>(["worktree", "current"], 30000, cwd);
  return current.result?.worktree || null;
}

export function orcaResolveRepoSelector(repoPath: string): string | null {
  const listed = runOrca<{ repos?: Array<{ id: string; path: string }> }>(["repo", "list"]);
  const match = listed.result?.repos?.find((r) => resolve(r.path) === resolve(repoPath));
  if (match) return `id:${match.id}`;

  const added = runOrca<{ repo?: { id: string } }>(["repo", "add", "--path", repoPath]);
  if (added.ok && added.result?.repo?.id) return `id:${added.result.repo.id}`;

  return null;
}

export function shortBranch(branch?: string): string {
  return (branch || "").replace(/^refs\/heads\//, "");
}

export function repoName(repoPath: string): string {
  return basename(repoPath);
}
