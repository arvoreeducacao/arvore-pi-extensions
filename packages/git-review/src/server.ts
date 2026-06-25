import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import parseDiff from "parse-diff";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, "..", "web");

export type DiffScope = "working" | "staged" | "branch";

export interface ReviewComment {
  type: "comment";
  file: string;
  startLine?: number;
  endLine?: number;
  code?: string;
  question: string;
}

export interface GitReviewServer {
  httpServer: Server;
  wss: WebSocketServer;
  clients: Set<WebSocket>;
  port: number;
  token: string;
  url: string;
  close(): void;
}

interface RepoDir {
  dir: string;
  prefix: string;
  label: string;
}

export interface RepoGroup {
  repo: string;
  branch: string;
  worktree: string | null;
  files: parseDiff.File[];
}

export interface PullRequest {
  repo: string;
  number: number;
  title: string;
  author: string;
  url: string;
  baseRefName: string;
  headRefName: string;
  isDraft: boolean;
  updatedAt: string;
  additions: number;
  deletions: number;
}

export interface PullRequestGroup {
  repo: string;
  prs: PullRequest[];
}

export interface PrContext {
  type: "pr_context";
  repo: string;
  number: number;
  title: string;
  author: string;
  url: string;
  baseRefName: string;
  headRefName: string;
  body: string;
}

async function detectBranch(pi: ExtensionAPI, dir: string): Promise<string> {
  try {
    const { stdout } = await pi.exec("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]);
    return stdout.trim() || "HEAD";
  } catch {
    return "HEAD";
  }
}

async function findRepoDirs(pi: ExtensionAPI): Promise<RepoDir[]> {
  let stdout = "";
  try {
    ({ stdout } = await pi.exec("find", [
      ".",
      "-maxdepth",
      "4",
      "-name",
      "node_modules",
      "-prune",
      "-o",
      "-name",
      ".git",
      "-print",
    ]));
  } catch {
    return [{ dir: ".", prefix: "", label: "." }];
  }
  const found = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((p) => p.replace(/\/\.git$/, ""));
  const repos = found.length > 0 ? [...new Set(found)] : ["."];
  return repos.map((dir) => {
    const clean = dir.replace(/^\.\//, "").replace(/\/\.worktrees\/[^/]+$/, "");
    return {
      dir,
      prefix: dir === "." ? "" : dir.replace(/^\.\//, "") + "/",
      label: clean || ".",
    };
  });
}

function worktreeName(dir: string): string | null {
  const m = dir.match(/\/\.worktrees\/([^/]+)$/);
  return m ? m[1] : null;
}

function diffArgsForScope(scope: DiffScope, base: string): string[] {
  switch (scope) {
    case "staged":
      return ["diff", "--staged"];
    case "branch":
      return ["diff", `${base}...HEAD`];
    default:
      return ["diff", "HEAD"];
  }
}

async function untrackedDiff(pi: ExtensionAPI, dir: string): Promise<string> {
  let files: string[] = [];
  try {
    const { stdout } = await pi.exec("git", [
      "-C",
      dir,
      "ls-files",
      "--others",
      "--exclude-standard",
    ]);
    files = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return "";
  }

  const diffs: string[] = [];
  for (const file of files) {
    try {
      const { stdout } = await pi.exec("git", [
        "-C",
        dir,
        "diff",
        "--no-index",
        "--",
        "/dev/null",
        file,
      ]);
      if (stdout.trim()) diffs.push(stdout);
    } catch (err: unknown) {
      const e = err as { stdout?: string };
      if (e && typeof e.stdout === "string" && e.stdout.trim()) diffs.push(e.stdout);
    }
  }
  return diffs.join("\n");
}

async function collectRepoGroups(
  pi: ExtensionAPI,
  scope: DiffScope,
  base: string,
): Promise<RepoGroup[]> {
  const repos = await findRepoDirs(pi);
  const groups: RepoGroup[] = [];

  for (const { dir, prefix, label } of repos) {
    try {
      const { stdout } = await pi.exec("git", ["-C", dir, ...diffArgsForScope(scope, base)]);
      let raw = stdout;
      if (scope === "working") {
        const extra = await untrackedDiff(pi, dir);
        if (extra.trim()) raw = raw.trim() ? `${raw}\n${extra}` : extra;
      }
      if (!raw.trim()) continue;
      const prefixed = raw
        .replace(/^diff --git a\//gm, `diff --git a/${prefix}`)
        .replace(/^(\+\+\+|---) ([ab])\//gm, `$1 $2/${prefix}`);
      const files = parseDiff(prefixed);
      if (!files.length) continue;
      groups.push({
        repo: label,
        branch: await detectBranch(pi, dir),
        worktree: worktreeName(dir),
        files,
      });
    } catch {}
  }

  groups.sort((a, b) => a.repo.localeCompare(b.repo));
  return groups;
}

async function collectPullRequests(pi: ExtensionAPI): Promise<PullRequestGroup[]> {
  const repos = await findRepoDirs(pi);
  const seen = new Set<string>();
  const groups: PullRequestGroup[] = [];

  for (const { dir, label } of repos) {
    if (seen.has(label)) continue;
    seen.add(label);
    try {
      const { stdout } = await pi.exec("gh", [
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        "50",
        "--json",
        "number,title,author,url,baseRefName,headRefName,isDraft,updatedAt,additions,deletions",
      ], { cwd: dir });
      const parsed = JSON.parse(stdout || "[]") as Array<{
        number: number;
        title: string;
        author?: { login?: string };
        url: string;
        baseRefName: string;
        headRefName: string;
        isDraft: boolean;
        updatedAt: string;
        additions?: number;
        deletions?: number;
      }>;
      if (!parsed.length) continue;
      const prs: PullRequest[] = parsed.map((p) => ({
        repo: label,
        number: p.number,
        title: p.title,
        author: p.author?.login || "unknown",
        url: p.url,
        baseRefName: p.baseRefName,
        headRefName: p.headRefName,
        isDraft: p.isDraft,
        updatedAt: p.updatedAt,
        additions: p.additions || 0,
        deletions: p.deletions || 0,
      }));
      prs.sort((a, b) => b.number - a.number);
      groups.push({ repo: label, prs });
    } catch {}
  }

  groups.sort((a, b) => a.repo.localeCompare(b.repo));
  return groups;
}

function repoDirForLabel(repos: RepoDir[], label: string): string | null {
  const match = repos.find((r) => r.label === label);
  return match ? match.dir : null;
}

async function collectPrDiff(
  pi: ExtensionAPI,
  repo: string,
  prNumber: number,
): Promise<{ files: parseDiff.File[]; context: PrContext } | null> {
  const repos = await findRepoDirs(pi);
  const dir = repoDirForLabel(repos, repo);
  if (!dir) return null;
  const prefix = repo === "." ? "" : repo + "/";

  const { stdout: viewOut } = await pi.exec("gh", [
    "pr",
    "view",
    String(prNumber),
    "--json",
    "number,title,author,url,baseRefName,headRefName,body",
  ], { cwd: dir });
  const view = JSON.parse(viewOut) as {
    number: number;
    title: string;
    author?: { login?: string };
    url: string;
    baseRefName: string;
    headRefName: string;
    body: string;
  };

  const { stdout: diffOut } = await pi.exec("gh", ["pr", "diff", String(prNumber)], {
    cwd: dir,
  });
  const prefixed = diffOut
    .replace(/^diff --git a\//gm, `diff --git a/${prefix}`)
    .replace(/^(\+\+\+|---) ([ab])\//gm, `$1 $2/${prefix}`);
  const files = parseDiff(prefixed);

  const context: PrContext = {
    type: "pr_context",
    repo,
    number: view.number,
    title: view.title,
    author: view.author?.login || "unknown",
    url: view.url,
    baseRefName: view.baseRefName,
    headRefName: view.headRefName,
    body: view.body || "",
  };

  return { files, context };
}

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

export function startGitReviewServer(
  port: number,
  pi: ExtensionAPI,
  clients: Set<WebSocket>,
  onMessage: (msg: ReviewComment | PrContext) => void,
): Promise<GitReviewServer> {
  const token = randomBytes(16).toString("hex");

  return new Promise((resolve, reject) => {
    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

      if (url.pathname === "/" || url.pathname === "/index.html") {
        serveStatic(res, "index.html", "text/html; charset=utf-8");
        return;
      }

      if (url.pathname === "/api/diff") {
        if (url.searchParams.get("token") !== token) {
          sendJson(res, 403, { error: "forbidden" });
          return;
        }
        const scope = (url.searchParams.get("scope") as DiffScope) || "working";
        const base = url.searchParams.get("base") || "main";
        try {
          const groups = await collectRepoGroups(pi, scope, base);
          sendJson(res, 200, { scope, base, groups });
        } catch (err) {
          sendJson(res, 500, { error: String(err) });
        }
        return;
      }

      if (url.pathname === "/api/prs") {
        if (url.searchParams.get("token") !== token) {
          sendJson(res, 403, { error: "forbidden" });
          return;
        }
        try {
          const groups = await collectPullRequests(pi);
          sendJson(res, 200, { groups });
        } catch (err) {
          sendJson(res, 500, { error: String(err) });
        }
        return;
      }

      if (url.pathname === "/api/pr-diff") {
        if (url.searchParams.get("token") !== token) {
          sendJson(res, 403, { error: "forbidden" });
          return;
        }
        const repo = url.searchParams.get("repo") || ".";
        const number = Number(url.searchParams.get("number"));
        if (!Number.isInteger(number) || number <= 0) {
          sendJson(res, 400, { error: "invalid pr number" });
          return;
        }
        try {
          const result = await collectPrDiff(pi, repo, number);
          if (!result) {
            sendJson(res, 404, { error: "repo not found" });
            return;
          }
          sendJson(res, 200, { repo, number, context: result.context, files: result.files });
        } catch (err) {
          sendJson(res, 500, { error: String(err) });
        }
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    });

    const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

    wss.on("connection", (ws, req) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      if (url.searchParams.get("token") !== token) {
        ws.close(1008, "invalid token");
        return;
      }

      clients.add(ws);
      ws.send(JSON.stringify({ type: "session", name: pi.getSessionName() || "Pi", port }));
      ws.on("close", () => clients.delete(ws));
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "comment" && typeof msg.question === "string" && msg.question.trim()) {
            onMessage(msg as ReviewComment);
          } else if (msg.type === "pr_context" && typeof msg.url === "string") {
            onMessage(msg as PrContext);
          }
        } catch {}
      });
    });

    httpServer.on("error", (err) => reject(err));
    httpServer.listen(port, "127.0.0.1", () => {
      resolve({
        httpServer,
        wss,
        clients,
        port,
        token,
        url: `http://127.0.0.1:${port}/?token=${token}`,
        close() {
          for (const client of clients) client.close();
          clients.clear();
          wss.close();
          httpServer.close();
        },
      });
    });
  });
}
