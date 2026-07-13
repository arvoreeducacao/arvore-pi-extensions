export interface Config {
  port: number;
  publicUrl: string;
  sessionSecret: string;
  sessionTtlSec: number;
  refreshTtlSec: number;
  browserTokenTtlSec: number;
  github: {
    appId: string;
    clientId: string;
    clientSecret: string;
    privateKey: string;
    webhookSecret: string;
    allowedOrg: string | null;
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env ${name}`);
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function decodePrivateKey(raw: string): string {
  if (raw.includes("BEGIN")) return raw.replace(/\\n/g, "\n");
  return Buffer.from(raw, "base64").toString("utf-8");
}

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached) return cached;
  const port = Number(process.env.PORT || 8080);
  cached = {
    port,
    publicUrl: (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ""),
    sessionSecret: required("SESSION_SECRET"),
    sessionTtlSec: Number(process.env.SESSION_TTL_SEC || 3600),
    refreshTtlSec: Number(process.env.REFRESH_TTL_SEC || 60 * 60 * 24 * 30),
    browserTokenTtlSec: Number(process.env.BROWSER_TOKEN_TTL_SEC || 60 * 60 * 8),
    github: {
      appId: required("GITHUB_APP_ID"),
      clientId: required("GITHUB_CLIENT_ID"),
      clientSecret: required("GITHUB_CLIENT_SECRET"),
      privateKey: decodePrivateKey(required("GITHUB_APP_PRIVATE_KEY")),
      webhookSecret: optional("GITHUB_WEBHOOK_SECRET"),
      allowedOrg: process.env.GITHUB_ALLOWED_ORG || null,
    },
  };
  return cached;
}
