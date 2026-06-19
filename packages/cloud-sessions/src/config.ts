import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ProviderKind = "git" | "icloud";

export interface GitProviderConfig {
  repo: string;
  branch: string;
  remoteName: string;
}

export interface IcloudProviderConfig {
  dir: string;
}

export interface CloudSessionsConfig {
  provider: ProviderKind;
  autoPush: boolean;
  pullOnStart: boolean;
  pushDebounceMs: number;
  pollIntervalMs: number;
  machineId: string;
  git: GitProviderConfig;
  icloud: IcloudProviderConfig;
}

const CONFIG_DIR = join(homedir(), ".config", "pi");
const CONFIG_FILE = join(CONFIG_DIR, "cloud-sessions.json");

function defaultIcloudDir(): string {
  return join(
    homedir(),
    "Library",
    "Mobile Documents",
    "com~apple~CloudDocs",
    "pi-sessions",
  );
}

function defaultMachineId(): string {
  if (process.env.PI_CLOUD_SESSIONS_MACHINE_ID) return process.env.PI_CLOUD_SESSIONS_MACHINE_ID;
  if (process.env.HOSTNAME) return process.env.HOSTNAME;
  if (process.env.HOST) return process.env.HOST;
  try { return execSync("hostname -s", { encoding: "utf-8" }).trim(); } catch { /* continue */ }
  try { return execSync("scutil --get ComputerName", { encoding: "utf-8" }).trim().replace(/\s+/g, "-"); } catch { /* continue */ }
  return "unknown-machine";
}

interface RawConfig {
  provider?: string;
  autoPush?: boolean;
  pullOnStart?: boolean;
  pushDebounceMs?: number;
  pollIntervalMs?: number;
  machineId?: string;
  git?: Partial<GitProviderConfig>;
  icloud?: Partial<IcloudProviderConfig>;
}

async function readRawConfig(): Promise<RawConfig> {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(await readFile(CONFIG_FILE, "utf-8")) as RawConfig;
  } catch {
    return {};
  }
}

function resolveProvider(raw: RawConfig): ProviderKind {
  const value = process.env.PI_CLOUD_SESSIONS_PROVIDER || raw.provider;
  return value === "icloud" ? "icloud" : "git";
}

function asBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value !== "0" && value.toLowerCase() !== "false";
}

export async function loadConfig(): Promise<CloudSessionsConfig> {
  const raw = await readRawConfig();

  return {
    provider: resolveProvider(raw),
    autoPush: asBool(process.env.PI_CLOUD_SESSIONS_AUTO_PUSH, raw.autoPush ?? true),
    pullOnStart: asBool(process.env.PI_CLOUD_SESSIONS_PULL_ON_START, raw.pullOnStart ?? true),
    pushDebounceMs: Number(process.env.PI_CLOUD_SESSIONS_DEBOUNCE_MS) || raw.pushDebounceMs || 4000,
    pollIntervalMs:
      Number(process.env.PI_CLOUD_SESSIONS_POLL_MS) ||
      (raw.pollIntervalMs === undefined ? 60000 : raw.pollIntervalMs),
    machineId: raw.machineId || defaultMachineId(),
    git: {
      repo: process.env.PI_CLOUD_SESSIONS_GIT_REPO || raw.git?.repo || "",
      branch: process.env.PI_CLOUD_SESSIONS_GIT_BRANCH || raw.git?.branch || "main",
      remoteName: raw.git?.remoteName || "origin",
    },
    icloud: {
      dir: process.env.PI_CLOUD_SESSIONS_ICLOUD_DIR || raw.icloud?.dir || defaultIcloudDir(),
    },
  };
}

export function isProviderConfigured(config: CloudSessionsConfig): boolean {
  if (config.provider === "git") return config.git.repo.length > 0;
  return config.icloud.dir.length > 0;
}

export function configFilePath(): string {
  return CONFIG_FILE;
}

export function configDir(): string {
  return CONFIG_DIR;
}
