import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";

export interface AuthedUser {
  id: string;
  username: string;
  org: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || "";
const ALLOWED_ORGS = (process.env.ALLOWED_ORGS || "").split(",").map((s) => s.trim()).filter(Boolean);

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Missing Authorization header" });
    return;
  }

  if (!JWT_SECRET) {
    res.status(500).json({ message: "JWT_SECRET not configured" });
    return;
  }

  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as {
      sub?: string;
      username?: string;
      orgs?: string[];
    };

    const orgs = payload.orgs ?? [];
    const allowedOrg =
      ALLOWED_ORGS.length === 0 ? orgs[0] : orgs.find((o) => ALLOWED_ORGS.includes(o));

    if (!allowedOrg) {
      res.status(403).json({ message: "User not in an allowed organization" });
      return;
    }

    req.user = {
      id: payload.sub ?? "unknown",
      username: payload.username ?? "unknown",
      org: allowedOrg,
    };
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}
