import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { index, sync } from "./api.js";
import type { RepoPath } from "./api.js";
import { chunkFile } from "./chunker.js";
import { snapshotRepo } from "./merkle.js";
import type { RepoSnapshot } from "./merkle.js";

const INDEX_FLUSH_BATCH = 32;

export type StatusFn = (text: string) => void;

async function discoverRepos(workspaceDir: string): Promise<{ name: string; dir: string }[]> {
  const repos: { name: string; dir: string }[] = [];

  if (existsSync(join(workspaceDir, ".git"))) {
    repos.push({ name: basename(workspaceDir), dir: workspaceDir });
  }

  let entries: string[] = [];
  try {
    entries = await readdir(workspaceDir);
  } catch {
    return repos;
  }

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const dir = join(workspaceDir, entry);
    if (existsSync(join(dir, ".git"))) {
      repos.push({ name: entry, dir });
    }
  }

  return repos;
}

function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

export async function runSync(workspaceDir: string, setStatus: StatusFn): Promise<void> {
  setStatus("codebase: checking sync…");

  const repos = await discoverRepos(workspaceDir);
  if (repos.length === 0) {
    setStatus("codebase: no repos");
    return;
  }

  const snapshots: (RepoSnapshot & { dir: string })[] = [];
  for (const repo of repos) {
    const snap = await snapshotRepo(repo.dir, repo.name);
    if (snap) {
      snapshots.push({ ...snap, dir: repo.dir });
    }
  }

  if (snapshots.length === 0) {
    setStatus("codebase: nothing to index");
    return;
  }

  const { changed } = await sync(
    snapshots.map((s) => ({ name: s.name, rootHash: s.rootHash, files: s.files }))
  );

  if (changed.length === 0) {
    setStatus(`codebase: ✓ up to date (${snapshots.length} repos)`);
    return;
  }

  await indexChanged(snapshots, changed, setStatus);
}

async function indexChanged(
  snapshots: (RepoSnapshot & { dir: string })[],
  changed: RepoPath[],
  setStatus: StatusFn
): Promise<void> {
  const dirByRepo = new Map(snapshots.map((s) => [s.name, s.dir]));
  const hashByKey = new Map<string, string>();
  for (const snap of snapshots) {
    for (const file of snap.files) {
      hashByKey.set(`${snap.name}\u0000${file.path}`, file.hash);
    }
  }

  const total = changed.length;
  let done = 0;
  let pending: Awaited<ReturnType<typeof chunkFile>> = [];

  const flush = async () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await index(batch);
        return;
      } catch {
        if (attempt === 3) break;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  };

  for (const item of changed) {
    const dir = dirByRepo.get(item.repo);
    const fileHash = hashByKey.get(`${item.repo}\u0000${item.path}`);
    if (dir && fileHash) {
      const chunks = await chunkFile(item.repo, dir, item.path, fileHash);
      pending.push(...chunks);
    }
    done += 1;
    setStatus(`codebase: indexing ${done}/${total}…`);

    if (pending.length >= INDEX_FLUSH_BATCH) {
      await flush();
    }
  }

  await flush();
  setStatus(`codebase: ✓ indexed ${total} files`);
}
