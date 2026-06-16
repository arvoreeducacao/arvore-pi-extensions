import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

export interface MemoryCredentials {
  token: string;
  username: string;
  expiresAt: number;
}

const CONFIG_DIR = join(homedir(), ".config", "pi");
const CREDENTIALS_FILE = join(CONFIG_DIR, "memory-credentials.json");

export async function getCredentials(): Promise<MemoryCredentials | null> {
  if (!existsSync(CREDENTIALS_FILE)) return null;

  const raw = await readFile(CREDENTIALS_FILE, "utf-8");
  const creds = JSON.parse(raw) as MemoryCredentials;

  if (Date.now() > creds.expiresAt) return null;

  return creds;
}

export async function saveCredentials(creds: MemoryCredentials): Promise<void> {
  await mkdir(dirname(CREDENTIALS_FILE), { recursive: true });
  await writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
}

export async function clearCredentials(): Promise<void> {
  if (existsSync(CREDENTIALS_FILE)) {
    await writeFile(CREDENTIALS_FILE, "{}");
  }
}
