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
  headRefOid: string;
  body: string;
}

export interface PrCommentEntry {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  htmlUrl: string;
}

export interface PrCommentThread {
  id: string;
  kind: "review" | "conversation";
  path?: string;
  line?: number;
  startLine?: number;
  side?: "LEFT" | "RIGHT";
  isResolved: boolean;
  isOutdated: boolean;
  htmlUrl: string;
  comments: PrCommentEntry[];
}

export interface CommentThreadMessage {
  type: "comment_thread";
  repo: string;
  number: number;
  thread: PrCommentThread;
  question?: string;
}

export interface CommentBatchMessage {
  type: "comment_batch";
  repo: string;
  number: number;
  threads: PrCommentThread[];
  note?: string;
}

export type IncomingMessage_ =
  | ReviewComment
  | PrContext
  | CommentThreadMessage
  | CommentBatchMessage;

async function detectBranch(pi: ExtensionAPI, dir: string): Promise<string> {
  try {
    const { stdout } = await pi.exec("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]);
    return stdout.trim() || "HEAD";
  } catch {
    return "HEAD";
  }
}

function excludeNestedRepos(dirs: string[]): string[] {
  const sorted = [...dirs].sort((a, b) => a.length - b.length);
  const kept: string[] = [];
  for (const dir of sorted) {
    const isWorktree = /\/\.worktrees\/[^/]+$/.test(dir);
    const isNested =
      !isWorktree &&
      kept.some((parent) => parent !== "." && parent !== dir && dir.startsWith(`${parent}/`));
    if (!isNested) kept.push(dir);
  }
  return kept;
}

let repoDirsCache: { dirs: RepoDir[]; expiresAt: number } | null = null;
const REPO_DIRS_TTL_MS = 60_000;

async function findRepoDirs(pi: ExtensionAPI): Promise<RepoDir[]> {
  if (repoDirsCache && repoDirsCache.expiresAt > Date.now()) {
    return repoDirsCache.dirs;
  }
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
  const deduped = found.length > 0 ? [...new Set(found)] : ["."];
  const repos = excludeNestedRepos(deduped);
  const result = repos.map((dir) => {
    const clean = dir.replace(/^\.\//, "").replace(/(?:^|\/)\.worktrees\/[^/]+$/, "");
    return {
      dir,
      prefix: dir === "." ? "" : dir.replace(/^\.\//, "") + "/",
      label: clean || ".",
    };
  });
  repoDirsCache = { dirs: result, expiresAt: Date.now() + REPO_DIRS_TTL_MS };
  return result;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
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

const PR_LIST_CONCURRENCY = 8;
const DIFF_CONCURRENCY = 8;

async function collectRepoGroups(
  pi: ExtensionAPI,
  scope: DiffScope,
  base: string,
): Promise<RepoGroup[]> {
  const repos = await findRepoDirs(pi);

  const results = await mapWithConcurrency(repos, DIFF_CONCURRENCY, async ({ dir, prefix, label }) => {
    try {
      const { stdout } = await pi.exec("git", ["-C", dir, ...diffArgsForScope(scope, base)]);
      let raw = stdout;
      if (scope === "working") {
        const extra = await untrackedDiff(pi, dir);
        if (extra.trim()) raw = raw.trim() ? `${raw}\n${extra}` : extra;
      }
      if (!raw.trim()) return null;
      const prefixed = raw
        .replace(/^diff --git a\//gm, `diff --git a/${prefix}`)
        .replace(/^(\+\+\+|---) ([ab])\//gm, `$1 $2/${prefix}`);
      const files = parseDiff(prefixed);
      if (!files.length) return null;
      const branch = await detectBranch(pi, dir);
      return { repo: label, branch, worktree: worktreeName(dir), files } satisfies RepoGroup;
    } catch {
      return null;
    }
  });

  const groups = results.filter((g): g is RepoGroup => g !== null);
  groups.sort((a, b) => a.repo.localeCompare(b.repo));
  return groups;
}

async function collectPullRequests(pi: ExtensionAPI): Promise<PullRequestGroup[]> {
  const repos = await findRepoDirs(pi);
  const seen = new Set<string>();
  const uniqueRepos = repos.filter(({ label }) => {
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });

  const results = await mapWithConcurrency(uniqueRepos, PR_LIST_CONCURRENCY, async ({ dir, label }) => {
    try {
      const { stdout } = await pi.exec("gh", [
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        "200",
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
      if (!parsed.length) return null;
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
      return { repo: label, prs } satisfies PullRequestGroup;
    } catch {
      return null;
    }
  });

  const groups = results.filter((g): g is PullRequestGroup => g !== null);
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
    "number,title,author,url,baseRefName,headRefName,headRefOid,body",
  ], { cwd: dir });
  const view = JSON.parse(viewOut) as {
    number: number;
    title: string;
    author?: { login?: string };
    url: string;
    baseRefName: string;
    headRefName: string;
    headRefOid: string;
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
    headRefOid: view.headRefOid,
    body: view.body || "",
  };

  return { files, context };
}

function repoSlugFromUrl(url: string): string | null {
  const match = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(url);
  return match ? match[1] : null;
}

async function prUrlForNumber(
  pi: ExtensionAPI,
  repo: string,
  prNumber: number,
): Promise<string | null> {
  const repos = await findRepoDirs(pi);
  const dir = repoDirForLabel(repos, repo);
  if (!dir) return null;
  try {
    const { stdout } = await pi.exec("gh", ["pr", "view", String(prNumber), "--json", "url"], {
      cwd: dir,
    });
    const parsed = JSON.parse(stdout) as { url?: string };
    return parsed.url || null;
  } catch {
    return null;
  }
}

function stripHtmlComments(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, "").trim();
}

async function collectPrComments(
  pi: ExtensionAPI,
  repo: string,
  prNumber: number,
): Promise<{ threads: PrCommentThread[] } | null> {
  const repos = await findRepoDirs(pi);
  const dir = repoDirForLabel(repos, repo);
  if (!dir) return null;

  const url = await prUrlForNumber(pi, repo, prNumber);
  const slug = url ? repoSlugFromUrl(url) : null;
  if (!slug) return { threads: [] };
  const [owner, name] = slug.split("/");

  const reviewComments = await fetchReviewComments(pi, dir, slug, prNumber);
  const issueComments = await fetchIssueComments(pi, dir, slug, prNumber);
  const threadState = await fetchReviewThreadState(pi, dir, owner, name, prNumber);

  const threads = buildReviewThreads(reviewComments, threadState);
  const conversation = buildConversationThreads(issueComments);

  return { threads: [...threads, ...conversation] };
}

interface RawReviewComment {
  id: number;
  in_reply_to_id?: number;
  path: string;
  line?: number | null;
  start_line?: number | null;
  side?: "LEFT" | "RIGHT" | null;
  body: string;
  created_at: string;
  html_url: string;
  user?: { login?: string };
}

interface RawIssueComment {
  id: number;
  body: string;
  created_at: string;
  html_url: string;
  user?: { login?: string };
}

interface ThreadState {
  isResolved: boolean;
  isOutdated: boolean;
}

async function fetchReviewComments(
  pi: ExtensionAPI,
  dir: string,
  slug: string,
  prNumber: number,
): Promise<RawReviewComment[]> {
  try {
    const { stdout } = await pi.exec(
      "gh",
      ["api", "--paginate", "--slurp", `repos/${slug}/pulls/${prNumber}/comments?per_page=100`],
      { cwd: dir },
    );
    const pages = JSON.parse(stdout || "[]") as RawReviewComment[][];
    return pages.flat();
  } catch {
    return [];
  }
}

async function fetchIssueComments(
  pi: ExtensionAPI,
  dir: string,
  slug: string,
  prNumber: number,
): Promise<RawIssueComment[]> {
  try {
    const { stdout } = await pi.exec(
      "gh",
      ["api", "--paginate", "--slurp", `repos/${slug}/issues/${prNumber}/comments?per_page=100`],
      { cwd: dir },
    );
    const pages = JSON.parse(stdout || "[]") as RawIssueComment[][];
    return pages.flat();
  } catch {
    return [];
  }
}

async function fetchReviewThreadState(
  pi: ExtensionAPI,
  dir: string,
  owner: string,
  name: string,
  prNumber: number,
): Promise<Map<number, ThreadState>> {
  const state = new Map<number, ThreadState>();
  try {
    let cursor: string | null = null;
    let hasNext = true;
    while (hasNext) {
      const query =
        `query($owner:String!,$name:String!,$number:Int!,$cursor:String){` +
        `repository(owner:$owner,name:$name){pullRequest(number:$number){` +
        `reviewThreads(first:100,after:$cursor){pageInfo{hasNextPage endCursor} nodes{isResolved isOutdated ` +
        `comments(first:100){nodes{databaseId}}}}}}}`;
      const args = [
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-F",
        `owner=${owner}`,
        "-F",
        `name=${name}`,
        "-F",
        `number=${prNumber}`,
      ];
      if (cursor) args.push("-F", `cursor=${cursor}`);
      const { stdout } = await pi.exec("gh", args, { cwd: dir });
      const parsed = JSON.parse(stdout) as {
        data?: {
          repository?: {
            pullRequest?: {
              reviewThreads?: {
                pageInfo?: { hasNextPage: boolean; endCursor: string | null };
                nodes?: Array<{
                  isResolved: boolean;
                  isOutdated: boolean;
                  comments?: { nodes?: Array<{ databaseId: number }> };
                }>;
              };
            };
          };
        };
      };
      const threads = parsed.data?.repository?.pullRequest?.reviewThreads;
      const nodes = threads?.nodes || [];
      for (const node of nodes) {
        const ts: ThreadState = { isResolved: node.isResolved, isOutdated: node.isOutdated };
        for (const c of node.comments?.nodes || []) {
          state.set(c.databaseId, ts);
        }
      }
      const pageInfo = threads?.pageInfo;
      hasNext = Boolean(pageInfo?.hasNextPage && pageInfo?.endCursor);
      cursor = pageInfo?.endCursor || null;
    }
  } catch {}
  return state;
}

function buildReviewThreads(
  comments: RawReviewComment[],
  threadState: Map<number, ThreadState>,
): PrCommentThread[] {
  const byId = new Map<number, RawReviewComment>();
  for (const c of comments) byId.set(c.id, c);

  const rootIdFor = (c: RawReviewComment): number => {
    let current = c;
    const guard = new Set<number>();
    while (current.in_reply_to_id && byId.has(current.in_reply_to_id)) {
      if (guard.has(current.id)) break;
      guard.add(current.id);
      current = byId.get(current.in_reply_to_id)!;
    }
    return current.id;
  };

  const grouped = new Map<number, RawReviewComment[]>();
  for (const c of comments) {
    const root = rootIdFor(c);
    const arr = grouped.get(root) || [];
    arr.push(c);
    grouped.set(root, arr);
  }

  const threads: PrCommentThread[] = [];
  for (const [rootId, members] of grouped) {
    members.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const root = byId.get(rootId)!;
    const state = threadState.get(rootId) || { isResolved: false, isOutdated: false };
    threads.push({
      id: String(rootId),
      kind: "review",
      path: root.path,
      line: root.line ?? undefined,
      startLine: root.start_line ?? undefined,
      side: root.side ?? undefined,
      isResolved: state.isResolved,
      isOutdated: state.isOutdated,
      htmlUrl: root.html_url,
      comments: members.map((m) => ({
        id: m.id,
        author: m.user?.login || "unknown",
        body: stripHtmlComments(m.body),
        createdAt: m.created_at,
        htmlUrl: m.html_url,
      })),
    });
  }

  threads.sort((a, b) => {
    const pathCmp = (a.path || "").localeCompare(b.path || "");
    if (pathCmp !== 0) return pathCmp;
    return (a.line || 0) - (b.line || 0);
  });
  return threads;
}

function buildConversationThreads(comments: RawIssueComment[]): PrCommentThread[] {
  return comments
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((c) => ({
      id: `issue-${c.id}`,
      kind: "conversation" as const,
      isResolved: false,
      isOutdated: false,
      htmlUrl: c.html_url,
      comments: [
        {
          id: c.id,
          author: c.user?.login || "unknown",
          body: stripHtmlComments(c.body),
          createdAt: c.created_at,
          htmlUrl: c.html_url,
        },
      ],
    }));
}

async function postReviewComment(
  pi: ExtensionAPI,
  repo: string,
  prNumber: number,
  input: {
    body: string;
    commitId: string;
    path: string;
    line: number;
    side?: "LEFT" | "RIGHT";
    startLine?: number;
    startSide?: "LEFT" | "RIGHT";
  },
): Promise<{ htmlUrl: string }> {
  const repos = await findRepoDirs(pi);
  const dir = repoDirForLabel(repos, repo);
  if (!dir) throw new Error("repo not found");
  const url = await prUrlForNumber(pi, repo, prNumber);
  const slug = url ? repoSlugFromUrl(url) : null;
  if (!slug) throw new Error("could not resolve repo slug");

  const prefix = repo === "." ? "" : repo + "/";
  const apiPath = input.path.startsWith(prefix) ? input.path.slice(prefix.length) : input.path;

  const args = [
    "api",
    `repos/${slug}/pulls/${prNumber}/comments`,
    "-X",
    "POST",
    "-f",
    `body=${input.body}`,
    "-f",
    `commit_id=${input.commitId}`,
    "-f",
    `path=${apiPath}`,
    "-F",
    `line=${input.line}`,
    "-f",
    `side=${input.side || "RIGHT"}`,
  ];
  if (input.startLine && input.startLine !== input.line) {
    args.push("-F", `start_line=${input.startLine}`, "-f", `start_side=${input.startSide || input.side || "RIGHT"}`);
  }
  const { stdout } = await pi.exec("gh", args, { cwd: dir });
  const parsed = JSON.parse(stdout) as { html_url?: string };
  return { htmlUrl: parsed.html_url || "" };
}

async function replyToComment(
  pi: ExtensionAPI,
  repo: string,
  prNumber: number,
  commentId: number,
  body: string,
): Promise<{ htmlUrl: string }> {
  const repos = await findRepoDirs(pi);
  const dir = repoDirForLabel(repos, repo);
  if (!dir) throw new Error("repo not found");
  const url = await prUrlForNumber(pi, repo, prNumber);
  const slug = url ? repoSlugFromUrl(url) : null;
  if (!slug) throw new Error("could not resolve repo slug");

  const { stdout } = await pi.exec(
    "gh",
    [
      "api",
      `repos/${slug}/pulls/${prNumber}/comments/${commentId}/replies`,
      "-X",
      "POST",
      "-f",
      `body=${body}`,
    ],
    { cwd: dir },
  );
  const parsed = JSON.parse(stdout) as { html_url?: string };
  return { htmlUrl: parsed.html_url || "" };
}

export type MergeMethod = "merge" | "squash" | "rebase";

export interface MergeStatus {
  state: string;
  mergeable: string;
  mergeStateStatus: string;
  isDraft: boolean;
  viewerPermission: string;
  canAdmin: boolean;
}

async function collectMergeStatus(
  pi: ExtensionAPI,
  repo: string,
  prNumber: number,
): Promise<MergeStatus | null> {
  const repos = await findRepoDirs(pi);
  const dir = repoDirForLabel(repos, repo);
  if (!dir) return null;

  const { stdout } = await pi.exec(
    "gh",
    ["pr", "view", String(prNumber), "--json", "state,mergeable,mergeStateStatus,isDraft"],
    { cwd: dir },
  );
  const view = JSON.parse(stdout) as {
    state?: string;
    mergeable?: string;
    mergeStateStatus?: string;
    isDraft?: boolean;
  };

  let viewerPermission = "";
  try {
    const { stdout: permOut } = await pi.exec("gh", ["repo", "view", "--json", "viewerPermission"], {
      cwd: dir,
    });
    viewerPermission = (JSON.parse(permOut) as { viewerPermission?: string }).viewerPermission || "";
  } catch {}

  return {
    state: view.state || "UNKNOWN",
    mergeable: view.mergeable || "UNKNOWN",
    mergeStateStatus: view.mergeStateStatus || "UNKNOWN",
    isDraft: Boolean(view.isDraft),
    viewerPermission,
    canAdmin: viewerPermission === "ADMIN",
  };
}

async function mergePullRequest(
  pi: ExtensionAPI,
  repo: string,
  prNumber: number,
  opts: { method: MergeMethod; deleteBranch?: boolean; admin?: boolean },
): Promise<{ ok: true }> {
  const repos = await findRepoDirs(pi);
  const dir = repoDirForLabel(repos, repo);
  if (!dir) throw new Error("repo not found");

  const args = ["pr", "merge", String(prNumber), `--${opts.method}`];
  if (opts.deleteBranch) args.push("--delete-branch");
  if (opts.admin) args.push("--admin");

  try {
    await pi.exec("gh", args, { cwd: dir });
  } catch (err) {
    const detail =
      err && typeof err === "object"
        ? String((err as { stderr?: string; message?: string }).stderr || (err as Error).message || err)
        : String(err);
    throw new Error(detail.trim() || "merge failed");
  }
  return { ok: true };
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
  onMessage: (msg: IncomingMessage_) => void,
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

      if (url.pathname === "/api/pr-comments") {
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
          const result = await collectPrComments(pi, repo, number);
          if (!result) {
            sendJson(res, 404, { error: "repo not found" });
            return;
          }
          sendJson(res, 200, { repo, number, threads: result.threads });
        } catch (err) {
          sendJson(res, 500, { error: String(err) });
        }
        return;
      }

      if (url.pathname === "/api/pr-comment" && req.method === "POST") {
        if ((req.headers["x-token"] as string) !== token) {
          sendJson(res, 403, { error: "forbidden" });
          return;
        }
        try {
          const body = await readJsonBody(req);
          const repo = String(body.repo || ".");
          const number = Number(body.number);
          const path = String(body.path || "");
          const line = Number(body.line);
          const commitId = String(body.commitId || "");
          const text = String(body.body || "");
          const startLine =
            body.startLine === undefined || body.startLine === null
              ? undefined
              : Number(body.startLine);
          if (
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
            return;
          }
          const result = await postReviewComment(pi, repo, number, {
            body: text,
            commitId,
            path,
            line,
            side: body.side === "LEFT" ? "LEFT" : "RIGHT",
            startLine,
            startSide: body.startSide === "LEFT" ? "LEFT" : undefined,
          });
          sendJson(res, 200, { ok: true, htmlUrl: result.htmlUrl });
        } catch (err) {
          sendJson(res, 500, { error: String(err) });
        }
        return;
      }

      if (url.pathname === "/api/pr-reply" && req.method === "POST") {
        if ((req.headers["x-token"] as string) !== token) {
          sendJson(res, 403, { error: "forbidden" });
          return;
        }
        try {
          const body = await readJsonBody(req);
          const repo = String(body.repo || ".");
          const number = Number(body.number);
          const commentId = Number(body.commentId);
          const text = String(body.body || "");
          if (!Number.isInteger(number) || number <= 0 || !Number.isInteger(commentId) || !text.trim()) {
            sendJson(res, 400, { error: "missing required fields" });
            return;
          }
          const result = await replyToComment(pi, repo, number, commentId, text);
          sendJson(res, 200, { ok: true, htmlUrl: result.htmlUrl });
        } catch (err) {
          sendJson(res, 500, { error: String(err) });
        }
        return;
      }

      if (url.pathname === "/api/pr-merge-status") {
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
          const status = await collectMergeStatus(pi, repo, number);
          if (!status) {
            sendJson(res, 404, { error: "repo not found" });
            return;
          }
          sendJson(res, 200, { status });
        } catch (err) {
          sendJson(res, 500, { error: String(err) });
        }
        return;
      }

      if (url.pathname === "/api/pr-merge" && req.method === "POST") {
        if ((req.headers["x-token"] as string) !== token) {
          sendJson(res, 403, { error: "forbidden" });
          return;
        }
        try {
          const body = await readJsonBody(req);
          const repo = String(body.repo || ".");
          const number = Number(body.number);
          if (body.method !== "merge" && body.method !== "squash" && body.method !== "rebase") {
            sendJson(res, 400, { error: "invalid merge method" });
            return;
          }
          const method: MergeMethod = body.method;
          if (!Number.isInteger(number) || number <= 0) {
            sendJson(res, 400, { error: "invalid pr number" });
            return;
          }
          const admin = Boolean(body.admin);
          if (admin) {
            const status = await collectMergeStatus(pi, repo, number);
            if (!status) {
              sendJson(res, 404, { error: "repo not found" });
              return;
            }
            const clean = status.mergeable === "MERGEABLE" && status.mergeStateStatus === "CLEAN";
            if (!status.canAdmin || clean) {
              sendJson(res, 403, { error: "admin override not allowed" });
              return;
            }
          }
          await mergePullRequest(pi, repo, number, {
            method,
            deleteBranch: Boolean(body.deleteBranch),
            admin,
          });
          sendJson(res, 200, { ok: true });
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    });

    const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
    wss.on("error", () => {});

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
          } else if (msg.type === "comment_thread" && msg.thread) {
            onMessage(msg as CommentThreadMessage);
          } else if (msg.type === "comment_batch" && Array.isArray(msg.threads)) {
            onMessage(msg as CommentBatchMessage);
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
