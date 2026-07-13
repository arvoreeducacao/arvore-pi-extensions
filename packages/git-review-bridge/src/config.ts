import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export interface BridgeConfig {
  cloudUrl: string;
  bridgeToken?: string;
  login?: string;
}

const CONFIG_DIR = join(homedir(), ".config", "pi");
const CONFIG_FILE = join(CONFIG_DIR, "git-review-cloud.json");

const DEFAULT_CLOUD_URL =
  process.env.GIT_REVIEW_CLOUD_URL || "https://git-review.arvore.com.br";

export async function loadConfig(): Promise<BridgeConfig> {
  if (!existsSync(CONFIG_FILE)) return { cloudUrl: DEFAULT_CLOUD_URL };
  try {
    const raw = await readFile(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<BridgeConfig>;
    return {
      cloudUrl: parsed.cloudUrl || DEFAULT_CLOUD_URL,
      bridgeToken: parsed.bridgeToken,
      login: parsed.login,
    };
  } catch {
    return { cloudUrl: DEFAULT_CLOUD_URL };
  }
}

export async function saveConfig(config: BridgeConfig): Promise<void> {
  await mkdir(dirname(CONFIG_FILE), { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}
