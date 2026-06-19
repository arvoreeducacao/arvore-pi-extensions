import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { IcloudProviderConfig } from "../config.js";
import { copyInto, listJsonlIn } from "./mirror.js";
import type { RemoteFile, SyncProvider } from "./types.js";

export class IcloudProvider implements SyncProvider {
  readonly kind = "icloud";
  private readonly dir: string;

  constructor(config: IcloudProviderConfig) {
    this.dir = config.dir;
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async pull(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async listRemote(): Promise<RemoteFile[]> {
    return listJsonlIn(this.dir);
  }

  mirrorPath(relativePath: string): string {
    return join(this.dir, relativePath);
  }

  async stageFromLocal(relativePath: string, localAbsolutePath: string): Promise<void> {
    await copyInto(this.dir, relativePath, localAbsolutePath);
  }

  async push(): Promise<void> {}
}
