import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

function discoverChildRepos(dir: string): string[] {
  try {
    return readdirSync(dir)
      .map((entry) => join(dir, entry))
      .filter((entry) => statSync(entry).isDirectory() && isGitRepo(entry))
      .sort((a, b) => basename(a).localeCompare(basename(b)));
  } catch {
    return [];
  }
}

function findHubRoot(cwd: string): string | null {
  let dir = resolve(cwd);
  let previous = "";

  while (dir !== previous) {
    const hasExplicitConfig = existsSync(join(dir, "hub.config.ts"));
    const hasHubLayout = !isGitRepo(dir) && existsSync(join(dir, "AGENTS.md")) && discoverChildRepos(dir).length > 0;
    if (hasExplicitConfig || hasHubLayout) return dir;
    previous = dir;
    dir = resolve(dir, "..");
  }

  return null;
}

function findGitRoot(cwd: string): string | null {
  let dir = resolve(cwd);
  let previous = "";

  while (dir !== previous) {
    if (isGitRepo(dir)) return dir;
    previous = dir;
    dir = resolve(dir, "..");
  }

  return null;
}

export function findWorkspaceRoot(cwd: string): string | null {
  return findHubRoot(cwd) || findGitRoot(cwd);
}

export function discoverRepos(cwd: string): string[] {
  const hubRoot = findHubRoot(cwd);
  if (hubRoot) return discoverChildRepos(hubRoot);

  const gitRoot = findGitRoot(cwd);
  return gitRoot ? [gitRoot] : [];
}
