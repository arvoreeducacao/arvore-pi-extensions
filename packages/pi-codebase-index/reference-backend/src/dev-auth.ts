import jwt from "jsonwebtoken";
import type { Express, Request, Response } from "express";

const JWT_SECRET = process.env.JWT_SECRET || "";
const TOKEN_TTL_SECONDS = 60 * 60 * 12;

function mintTokens(username: string, org: string): {
  access_token: string;
  refresh_token: string;
  expires_in: number;
} {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: username,
    username,
    orgs: [org],
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const access_token = jwt.sign(payload, JWT_SECRET);
  return { access_token, refresh_token: access_token, expires_in: TOKEN_TTL_SECONDS };
}

export function registerDevAuth(app: Express): void {
  app.get("/auth/:provider/start", (req: Request, res: Response) => {
    const redirectUrl = String(req.query.redirect_url || "");
    if (!redirectUrl) {
      res.status(400).send("Missing redirect_url");
      return;
    }
    const username = String(req.query.username || "dev-user");
    const org = String(req.query.org || process.env.DEV_AUTH_ORG || "local");
    const { access_token, refresh_token } = mintTokens(username, org);
    const target = new URL(redirectUrl);
    target.searchParams.set("token", access_token);
    target.searchParams.set("refresh_token", refresh_token);
    res.redirect(target.toString());
  });

  app.post("/auth/:provider/refresh", (req: Request, res: Response) => {
    const refreshToken = req.body?.refresh_token as string | undefined;
    if (!refreshToken) {
      res.status(400).json({ message: "Missing refresh_token" });
      return;
    }
    try {
      const decoded = jwt.verify(refreshToken, JWT_SECRET, { ignoreExpiration: true }) as {
        username?: string;
        orgs?: string[];
      };
      const tokens = mintTokens(decoded.username ?? "dev-user", decoded.orgs?.[0] ?? "local");
      res.json(tokens);
    } catch {
      res.status(401).json({ message: "Invalid refresh_token" });
    }
  });
}
