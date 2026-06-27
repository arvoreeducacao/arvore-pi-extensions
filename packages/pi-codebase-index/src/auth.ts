import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { getConfig } from "./config.js";

export interface CodebaseCredentials {
  token: string;
  refreshToken?: string;
  username: string;
  expiresAt: number;
}

const CONFIG_DIR = join(homedir(), ".config", "pi");
const CREDENTIALS_FILE = join(CONFIG_DIR, "codebase-credentials.json");
const EXPIRY_SKEW_MS = 60_000;

async function readCredentials(): Promise<CodebaseCredentials | null> {
  if (!existsSync(CREDENTIALS_FILE)) return null;

  try {
    const raw = await readFile(CREDENTIALS_FILE, "utf-8");
    const creds = JSON.parse(raw) as CodebaseCredentials;
    if (!creds.token) return null;
    return creds;
  } catch {
    return null;
  }
}

export async function getCredentials(): Promise<CodebaseCredentials | null> {
  const creds = await readCredentials();
  if (!creds) return null;

  if (Date.now() < creds.expiresAt - EXPIRY_SKEW_MS) {
    return creds;
  }

  if (creds.refreshToken) {
    const refreshed = await tryRefresh(creds.refreshToken);
    if (refreshed) return refreshed;
  }

  return null;
}

async function tryRefresh(refreshToken: string): Promise<CodebaseCredentials | null> {
  try {
    const config = getConfig();
    const response = await fetch(
      `${config.apiUrl}/auth/${config.authProvider}/refresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }
    );

    if (!response.ok) return null;

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const payload = JSON.parse(
      Buffer.from(data.access_token.split(".")[1], "base64url").toString()
    );

    const creds: CodebaseCredentials = {
      token: data.access_token,
      refreshToken: data.refresh_token,
      username: payload.username,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    await saveCredentials(creds);
    return creds;
  } catch {
    return null;
  }
}

export async function saveCredentials(creds: CodebaseCredentials): Promise<void> {
  await mkdir(dirname(CREDENTIALS_FILE), { recursive: true });
  await writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
}

export async function clearCredentials(): Promise<void> {
  if (existsSync(CREDENTIALS_FILE)) {
    await writeFile(CREDENTIALS_FILE, "{}");
  }
}
