import type { CloudSessionsConfig } from "../config.js";
import { GitProvider } from "./git.js";
import { IcloudProvider } from "./icloud.js";
import type { SyncProvider } from "./types.js";

export function createProvider(config: CloudSessionsConfig): SyncProvider {
  if (config.provider === "icloud") {
    return new IcloudProvider(config.icloud);
  }
  return new GitProvider(config.git);
}

export type { SyncProvider, RemoteFile } from "./types.js";
