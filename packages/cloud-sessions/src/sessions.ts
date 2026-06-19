import { readdir, stat, mkdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface LocalSession {
  relativePath: string;
  absolutePath: string;
  mtimeMs: number;
  size: number;
  hash: string;
}

export function sessionsRoot(): string {
  return join(getAgentDir(), "sessions");
}

function hashFile(absolutePath: string): string {
  const content = readFileSync(absolutePath);
  return createHash("sha256").update(content).digest("hex");
}

async function walkJsonl(dir: string, root: string, out: LocalSession[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkJsonl(full, root, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    const info = await stat(full);
    out.push({
      relativePath: relative(root, full),
      absolutePath: full,
      mtimeMs: info.mtimeMs,
      size: info.size,
      hash: hashFile(full),
    });
  }
}

export async function listLocalSessions(): Promise<LocalSession[]> {
  const root = sessionsRoot();
  if (!existsSync(root)) {
    await mkdir(root, { recursive: true });
    return [];
  }
  const out: LocalSession[] = [];
  await walkJsonl(root, root, out);
  return out;
}

export async function ensureSessionsRoot(): Promise<string> {
  const root = sessionsRoot();
  await mkdir(root, { recursive: true });
  return root;
}
