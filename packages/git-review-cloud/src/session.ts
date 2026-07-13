import { SignJWT, jwtVerify } from "jose";
import { getConfig } from "./config.js";

export type Audience = "session" | "refresh" | "browser" | "bridge";

export interface SessionClaims {
  sub: string;
  login: string;
  avatarUrl?: string;
  aud: Audience;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(getConfig().sessionSecret);
}

function ttlFor(aud: Audience): number {
  const cfg = getConfig();
  switch (aud) {
    case "session":
      return cfg.sessionTtlSec;
    case "refresh":
      return cfg.refreshTtlSec;
    case "browser":
      return cfg.browserTokenTtlSec;
    case "bridge":
      return cfg.refreshTtlSec;
  }
}

export async function issueToken(claims: Omit<SessionClaims, "aud">, aud: Audience): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ login: claims.login, avatarUrl: claims.avatarUrl })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setAudience(aud)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlFor(aud))
    .sign(secret());
}

export async function verifyToken(token: string, aud: Audience): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: aud });
    return {
      sub: String(payload.sub),
      login: String((payload as Record<string, unknown>).login || ""),
      avatarUrl: (payload as Record<string, unknown>).avatarUrl as string | undefined,
      aud,
    };
  } catch {
    return null;
  }
}
