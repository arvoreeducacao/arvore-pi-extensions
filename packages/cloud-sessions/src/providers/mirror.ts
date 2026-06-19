import { readdir, stat, mkdir, copyFile, utimes } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import type { RemoteFile } from "./types.js";

export function hashFileSync(absolutePath: string): string {
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
}

async function walk(dir: string, root: string, out: RemoteFile[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, root, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const info = await stat(full);
    out.push({
      relativePath: relative(root, full),
      mtimeMs: info.mtimeMs,
      size: info.size,
      hash: hashFileSync(full),
    });
  }
}

export async function listJsonlIn(root: string): Promise<RemoteFile[]> {
  if (!existsSync(root)) return [];
  const out: RemoteFile[] = [];
  await walk(root, root, out);
  return out;
}

export async function copyInto(
  root: string,
  relativePath: string,
  sourceAbsolutePath: string,
): Promise<void> {
  const dest = join(root, relativePath);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(sourceAbsolutePath, dest);
  const info = await stat(sourceAbsolutePath);
  await utimes(dest, info.atime, info.mtime);
}
