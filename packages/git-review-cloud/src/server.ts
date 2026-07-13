import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { getConfig } from "./config.js";
import {
  exchangeOAuthCode,
  pollDeviceFlow,
  startDeviceFlow,
  userFromToken,
  userInAllowedOrg,
} from "./github-app.js";
import { issueToken, verifyToken } from "./session.js";
import { attachBridge, attachBrowser, sessionsFor } from "./hub.js";
import {
  getMergeStatus,
  getPrComments,
  getPrDiff,
  listPullRequests,
  mergePullRequest,
  postReviewComment,
  replyToComment,
} from "./github-pr.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, "..", "web");

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function serveStatic(res: ServerResponse, file: string, contentType: string): void {
  try {
    const data = readFileSync(join(WEB_DIR, file));
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function cookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie || "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

async function browserClaims(req: IncomingMessage, url: URL) {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const cookieToken = cookies(req)["gr_session"];
  const queryToken = url.searchParams.get("token");
  const token = bearer || cookieToken || queryToken;
  if (!token) return null;
  return verifyToken(token, "browser");
}

const oauthStates = new Map<string, number>();
const deviceCodes = new Map<string, { deviceCode: string; expiresAt: number }>();

function pruneMaps(): void {
  const now = Date.now();
  for (const [k, v] of oauthStates) if (v < now) oauthStates.delete(k);
  for (const [k, v] of deviceCodes) if (v.expiresAt < now) deviceCodes.delete(k);
}
setInterval(pruneMaps, 60_000).unref();

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const cfg = getConfig();

  if (url.pathname === "/healthz") {
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (url.pathname === "/logout") {
    res.writeHead(302, {
      Location: "/auth/github/login",
      "Set-Cookie": "gr_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
    });
    res.end();
    return true;
  }

  if (url.pathname === "/auth/github/login") {
    const state = randomUUID();
    oauthStates.set(state, Date.now() + 10 * 60_000);
    const redirect = new URL("https://github.com/login/oauth/authorize");
    redirect.searchParams.set("client_id", cfg.github.clientId);
    redirect.searchParams.set("redirect_uri", `${cfg.publicUrl}/auth/github/callback`);
    redirect.searchParams.set("state", state);
    redirect.searchParams.set("scope", "read:user read:org");
    res.writeHead(302, { Location: redirect.toString() });
    res.end();
    return true;
  }

  if (url.pathname === "/auth/github/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state || !oauthStates.has(state)) {
      sendJson(res, 400, { error: "invalid oauth state" });
      return true;
    }
    oauthStates.delete(state);
    try {
      const tokens = await exchangeOAuthCode(code);
      if (!(await userInAllowedOrg(tokens.accessToken))) {
        sendJson(res, 403, { error: "not a member of the allowed org" });
        return true;
      }
      const user = await userFromToken(tokens.accessToken);
      const session = await issueToken(
        { sub: String(user.id), login: user.login, avatarUrl: user.avatarUrl },
        "browser",
      );
      res.writeHead(302, {
        Location: "/?mode=prs",
        "Set-Cookie": `gr_session=${session}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${cfg.browserTokenTtlSec}`,
      });
      res.end();
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  if (url.pathname === "/auth/device/start" && req.method === "POST") {
    try {
      const flow = await startDeviceFlow();
      const handle = randomUUID();
      deviceCodes.set(handle, {
        deviceCode: flow.deviceCode,
        expiresAt: Date.now() + flow.expiresIn * 1000,
      });
      sendJson(res, 200, {
        handle,
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
        interval: flow.interval,
        expiresIn: flow.expiresIn,
      });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  if (url.pathname === "/auth/device/poll" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const handle = String(body.handle || "");
      const entry = deviceCodes.get(handle);
      if (!entry) {
        sendJson(res, 400, { error: "unknown handle" });
        return true;
      }
      const result = await pollDeviceFlow(entry.deviceCode);
      if (result.status === "done") {
        deviceCodes.delete(handle);
        if (!(await userInAllowedOrg(result.tokens.accessToken))) {
          sendJson(res, 403, { error: "not a member of the allowed org" });
          return true;
        }
        const user = await userFromToken(result.tokens.accessToken);
        const bridge = await issueToken(
          { sub: String(user.id), login: user.login, avatarUrl: user.avatarUrl },
          "bridge",
        );
        sendJson(res, 200, { status: "done", bridgeToken: bridge, login: user.login });
        return true;
      }
      sendJson(res, 200, { status: result.status });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  if (url.pathname.startsWith("/api/")) {
    const claims = await browserClaims(req, url);
    if (!claims) {
      sendJson(res, 401, { error: "unauthorized" });
      return true;
    }

    if (url.pathname === "/api/me") {
      sendJson(res, 200, { login: claims.login, avatarUrl: claims.avatarUrl });
      return true;
    }

    if (url.pathname === "/api/sessions") {
      sendJson(res, 200, { sessions: sessionsFor(claims.sub) });
      return true;
    }

    if (url.pathname === "/api/prs") {
      const repos = new Set<string>();
      for (const s of sessionsFor(claims.sub)) for (const r of s.repos) repos.add(r);
      const requested = url.searchParams.get("repo");
      if (requested) repos.add(requested);
      try {
        const settled = await Promise.all(
          [...repos].map(async (slug) => {
            try {
              return { group: await listPullRequests(slug), error: null };
            } catch (err) {
              return { group: null, repo: slug, error: String(err) };
            }
          }),
        );
        const groups = settled.filter((s) => s.group).map((s) => s.group);
        const errors = settled
          .filter((s) => s.error)
          .map((s) => ({ repo: (s as { repo: string }).repo, error: s.error }));
        sendJson(res, 200, { groups, errors });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
      return true;
    }

    if (url.pathname === "/api/pr-diff") {
      const repo = url.searchParams.get("repo") || "";
      const number = Number(url.searchParams.get("number"));
      if (!repo.includes("/") || !Number.isInteger(number) || number <= 0) {
        sendJson(res, 400, { error: "invalid repo or number" });
        return true;
      }
      try {
        const { files, context } = await getPrDiff(repo, number);
        sendJson(res, 200, { repo, number, files, context });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
      return true;
    }

    if (url.pathname === "/api/pr-comments") {
      const repo = url.searchParams.get("repo") || "";
      const number = Number(url.searchParams.get("number"));
      if (!repo.includes("/") || !Number.isInteger(number) || number <= 0) {
        sendJson(res, 400, { error: "invalid repo or number" });
        return true;
      }
      try {
        const result = await getPrComments(repo, number);
        sendJson(res, 200, { repo, number, threads: result.threads });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
      return true;
    }

    if (url.pathname === "/api/pr-merge-status") {
      const repo = url.searchParams.get("repo") || "";
      const number = Number(url.searchParams.get("number"));
      if (!repo.includes("/") || !Number.isInteger(number) || number <= 0) {
        sendJson(res, 400, { error: "invalid repo or number" });
        return true;
      }
      try {
        const status = await getMergeStatus(repo, number, claims.login);
        sendJson(res, 200, status);
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
      return true;
    }

    if (url.pathname === "/api/pr-comment" && req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        const repo = String(body.repo || "");
        const number = Number(body.number);
        const path = String(body.path || "");
        const line = Number(body.line);
        const commitId = String(body.commitId || "");
        const text = String(body.body || "");
        const startLine =
          body.startLine === undefined || body.startLine === null ? undefined : Number(body.startLine);
        if (
          !repo.includes("/") ||
          !Number.isInteger(number) ||
          number <= 0 ||
          !path ||
          !Number.isInteger(line) ||
          line <= 0 ||
          !commitId ||
          !text.trim() ||
          (startLine !== undefined && (!Number.isInteger(startLine) || startLine <= 0 || startLine > line))
        ) {
          sendJson(res, 400, { error: "missing required fields" });
          return true;
        }
        const result = await postReviewComment(repo, number, { body: text, commitId, path, line, startLine });
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
      return true;
    }

    if (url.pathname === "/api/pr-reply" && req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        const repo = String(body.repo || "");
        const number = Number(body.number);
        const commentId = Number(body.commentId);
        const text = String(body.body || "");
        if (!repo.includes("/") || !Number.isInteger(number) || !Number.isInteger(commentId) || !text.trim()) {
          sendJson(res, 400, { error: "missing required fields" });
          return true;
        }
        const result = await replyToComment(repo, number, commentId, text);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
      return true;
    }

    if (url.pathname === "/api/pr-merge" && req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        const repo = String(body.repo || "");
        const number = Number(body.number);
        const method = String(body.method || "squash") as "merge" | "squash" | "rebase";
        if (!repo.includes("/") || !Number.isInteger(number) || !["merge", "squash", "rebase"].includes(method)) {
          sendJson(res, 400, { error: "invalid request" });
          return true;
        }
        const result = await mergePullRequest(repo, number, { method });
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
      return true;
    }

    sendJson(res, 404, { error: "not found" });
    return true;
  }

  return false;
}

export function startServer(): void {
  const cfg = getConfig();
  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url || "/", cfg.publicUrl);
    try {
      const handled = await handleApi(req, res, url);
      if (handled) return;
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
      return;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const claims = await browserClaims(req, url);
      if (!claims) {
        res.writeHead(302, { Location: "/auth/github/login" });
        res.end();
        return;
      }
      serveStatic(res, "index.html", "text/html; charset=utf-8");
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", cfg.publicUrl);
    if (url.pathname === "/ws/bridge") {
      const token = url.searchParams.get("token") || "";
      verifyToken(token, "bridge").then((claims) => {
        if (!claims) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => attachBridge(ws, claims));
      });
      return;
    }
    if (url.pathname === "/ws/browser") {
      const token = cookies(req)["gr_session"] || url.searchParams.get("token") || "";
      verifyToken(token, "browser").then((claims) => {
        if (!claims) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => attachBrowser(ws, claims));
      });
      return;
    }
    socket.destroy();
  });

  httpServer.listen(cfg.port, () => {
    console.log(`git-review-cloud listening on :${cfg.port} (${cfg.publicUrl})`);
  });
}
