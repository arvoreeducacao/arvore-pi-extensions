import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

const MAX_FILE_BYTES = 256 * 1024;

const INDEXABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".ex", ".exs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java", ".kt",
  ".php",
  ".c", ".h", ".cc", ".cpp", ".hpp",
  ".cs",
  ".swift",
  ".sql",
  ".graphql", ".gql",
]);

export interface RepoFile {
  path: string;
  hash: string;
}

export interface RepoSnapshot {
  name: string;
  rootHash: string;
  files: RepoFile[];
}

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

async function listTrackedFiles(repoDir: string): Promise<string[]> {
  try {
    const { stdout } = await exec("git", ["-C", repoDir, "ls-files"], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function hashFile(absPath: string): Promise<string | null> {
  try {
    const content = await readFile(absPath);
    if (content.byteLength > MAX_FILE_BYTES) return null;
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

export async function snapshotRepo(repoDir: string, name: string): Promise<RepoSnapshot | null> {
  const tracked = await listTrackedFiles(repoDir);
  if (tracked.length === 0) return null;

  const files: RepoFile[] = [];
  for (const rel of tracked) {
    if (!INDEXABLE_EXTENSIONS.has(extOf(rel))) continue;
    const hash = await hashFile(join(repoDir, rel));
    if (!hash) continue;
    files.push({ path: rel, hash });
  }

  if (files.length === 0) return null;

  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const rootHash = createHash("sha256")
    .update(files.map((f) => `${f.path}:${f.hash}`).join("\n"))
    .digest("hex");

  return { name, rootHash, files };
}
