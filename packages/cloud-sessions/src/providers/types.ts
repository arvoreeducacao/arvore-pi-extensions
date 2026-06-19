export interface RemoteFile {
  relativePath: string;
  mtimeMs: number;
  size: number;
  hash: string;
}

export interface SyncProvider {
  readonly kind: string;

  ensureReady(): Promise<void>;

  pull(): Promise<void>;

  listRemote(): Promise<RemoteFile[]>;

  mirrorPath(relativePath: string): string;

  stageFromLocal(relativePath: string, localAbsolutePath: string): Promise<void>;

  push(message: string): Promise<void>;
}
