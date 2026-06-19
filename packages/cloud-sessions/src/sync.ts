import { copyFile, mkdir, stat, utimes } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CloudSessionsConfig } from "./config.js";
import { createProvider, type SyncProvider } from "./providers/index.js";
import { listLocalSessions, sessionsRoot } from "./sessions.js";

const MTIME_TOLERANCE_MS = 1500;

export interface SyncResult {
  pulled: string[];
  pushed: string[];
  unchanged: number;
}

interface FileState {
  hash: string;
  mtimeMs: number;
}

async function copyRemoteToLocal(remoteAbsolutePath: string, localRelativePath: string): Promise<void> {
  const dest = join(sessionsRoot(), localRelativePath);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(remoteAbsolutePath, dest);
  const info = await stat(remoteAbsolutePath);
  await utimes(dest, info.atime, info.mtime);
}

export class Sync {
  private readonly provider: SyncProvider;
  private readonly machineId: string;

  constructor(config: CloudSessionsConfig) {
    this.provider = createProvider(config);
    this.machineId = config.machineId;
  }

  get providerKind(): string {
    return this.provider.kind;
  }

  async run(): Promise<SyncResult> {
    await this.provider.ensureReady();
    await this.provider.pull();

    const local = await listLocalSessions();
    const remote = await this.provider.listRemote();

    const localByPath = new Map<string, FileState & { absolutePath: string }>();
    for (const f of local) {
      localByPath.set(f.relativePath, { hash: f.hash, mtimeMs: f.mtimeMs, absolutePath: f.absolutePath });
    }
    const remoteByPath = new Map<string, FileState>();
    for (const f of remote) {
      remoteByPath.set(f.relativePath, { hash: f.hash, mtimeMs: f.mtimeMs });
    }

    const allPaths = new Set<string>([...localByPath.keys(), ...remoteByPath.keys()]);
    const result: SyncResult = { pulled: [], pushed: [], unchanged: 0 };

    for (const path of allPaths) {
      const l = localByPath.get(path);
      const r = remoteByPath.get(path);

      if (l && !r) {
        await this.provider.stageFromLocal(path, l.absolutePath);
        result.pushed.push(path);
        continue;
      }

      if (!l && r) {
        await copyRemoteToLocal(this.provider.mirrorPath(path), path);
        result.pulled.push(path);
        continue;
      }

      if (l && r) {
        if (l.hash === r.hash) {
          result.unchanged += 1;
          continue;
        }
        const delta = l.mtimeMs - r.mtimeMs;
        if (delta > MTIME_TOLERANCE_MS) {
          await this.provider.stageFromLocal(path, l.absolutePath);
          result.pushed.push(path);
        } else if (delta < -MTIME_TOLERANCE_MS) {
          await copyRemoteToLocal(this.provider.mirrorPath(path), path);
          result.pulled.push(path);
        } else if (l.mtimeMs >= r.mtimeMs) {
          await this.provider.stageFromLocal(path, l.absolutePath);
          result.pushed.push(path);
        } else {
          await copyRemoteToLocal(this.provider.mirrorPath(path), path);
          result.pulled.push(path);
        }
      }
    }

    if (result.pushed.length > 0) {
      const message = `sync from ${this.machineId}: ${result.pushed.length} session(s) @ ${new Date().toISOString()}`;
      await this.provider.push(message);
    }

    return result;
  }
}
