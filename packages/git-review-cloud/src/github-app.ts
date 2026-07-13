import { createHmac, timingSafeEqual } from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";
import { getConfig } from "./config.js";

const GH_API = "https://api.github.com";
const GH_LOGIN = "https://github.com";

export interface GithubUser {
  id: number;
  login: string;
  avatarUrl: string;
}

async function appJwt(): Promise<string> {
  const { github } = getConfig();
  const key = await importPKCS8(github.privateKey, "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now - 30)
    .setExpirationTime(now + 540)
    .setIssuer(github.appId)
    .sign(key);
}

async function appRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const jwt = await appJwt();
  const res = await fetch(`${GH_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "git-review-cloud",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub App API ${res.status} on ${path}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

interface Installation {
  id: number;
  account: { login: string };
}

const installationCache = new Map<string, { id: number; expiresAt: number }>();

async function installationIdForOwner(owner: string): Promise<number> {
  const cached = installationCache.get(owner.toLowerCase());
  if (cached && cached.expiresAt > Date.now()) return cached.id;
  const inst = await appRequest<Installation>(`/orgs/${owner}/installation`).catch(() =>
    appRequest<Installation>(`/users/${owner}/installation`).catch(() => {
      throw new Error(
        `GitHub App is not installed on "${owner}". Install it at https://github.com/settings/apps and grant the repos you want to review.`,
      );
    }),
  );
  installationCache.set(owner.toLowerCase(), {
    id: inst.id,
    expiresAt: Date.now() + 10 * 60_000,
  });
  return inst.id;
}

const tokenCache = new Map<number, { token: string; expiresAt: number }>();

export async function installationToken(owner: string): Promise<string> {
  const id = await installationIdForOwner(owner);
  const cached = tokenCache.get(id);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const res = await appRequest<{ token: string; expires_at: string }>(
    `/app/installations/${id}/access_tokens`,
    { method: "POST" },
  );
  tokenCache.set(id, { token: res.token, expiresAt: new Date(res.expires_at).getTime() });
  return res.token;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

export async function exchangeOAuthCode(code: string): Promise<OAuthTokens> {
  const { github, publicUrl } = getConfig();
  const res = await fetch(`${GH_LOGIN}/login/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: github.clientId,
      client_secret: github.clientSecret,
      code,
      redirect_uri: `${publicUrl}/auth/github/callback`,
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!data.access_token) throw new Error(data.error_description || "oauth exchange failed");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

export async function startDeviceFlow(): Promise<{
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
}> {
  const { github } = getConfig();
  const res = await fetch(`${GH_LOGIN}/login/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: github.clientId }),
  });
  const data = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    interval: number;
    expires_in: number;
  };
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: data.interval,
    expiresIn: data.expires_in,
  };
}

export async function pollDeviceFlow(deviceCode: string): Promise<
  | { status: "pending" | "slow_down" }
  | { status: "done"; tokens: OAuthTokens }
  | { status: "error"; error: string }
> {
  const { github } = getConfig();
  const res = await fetch(`${GH_LOGIN}/login/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: github.clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (data.access_token) {
    return {
      status: "done",
      tokens: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
      },
    };
  }
  if (data.error === "authorization_pending") return { status: "pending" };
  if (data.error === "slow_down") return { status: "slow_down" };
  return { status: "error", error: data.error || "device flow failed" };
}

export async function userFromToken(accessToken: string): Promise<GithubUser> {
  const res = await fetch(`${GH_API}/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "git-review-cloud",
    },
  });
  if (!res.ok) throw new Error(`github /user ${res.status}`);
  const u = (await res.json()) as { id: number; login: string; avatar_url: string };
  return { id: u.id, login: u.login, avatarUrl: u.avatar_url };
}

export async function userInAllowedOrg(accessToken: string): Promise<boolean> {
  const { github } = getConfig();
  if (!github.allowedOrg) return true;
  const res = await fetch(`${GH_API}/user/memberships/orgs/${github.allowedOrg}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "git-review-cloud",
    },
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { state?: string };
  return data.state === "active";
}

export function verifyWebhookSignature(payload: Buffer, signature: string | undefined): boolean {
  const { github } = getConfig();
  if (!github.webhookSecret) return true;
  if (!signature) return false;
  const digest = `sha256=${createHmac("sha256", github.webhookSecret).update(payload).digest("hex")}`;
  const a = Buffer.from(digest);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
