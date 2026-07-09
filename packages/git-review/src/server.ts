import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
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
  warmPrs(): void;
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

const UNTRACKED_MAX_FILES = 300;
const UNTRACKED_MAX_FILE_BYTES = 262_144;
const UNTRACKED_MAX_TOTAL_BYTES = 2_000_000;
const UNTRACKED_CONCURRENCY = 8;

function omittedFileStub(path: string, reason: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ b/${path}`,
    "@@ -0,0 +1 @@",
    `+[git-review: untracked file omitted — ${reason}]`,
    "",
  ].join("\n");
}

function formatBytes(size: number): string {
  if (size >= 1_048_576) return `${(size / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
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
  if (!files.length) return "";

  const kept = files.slice(0, UNTRACKED_MAX_FILES);
  const overflow = files.slice(UNTRACKED_MAX_FILES);

  let totalBytes = 0;
  const diffs = await mapWithConcurrency(kept, UNTRACKED_CONCURRENCY, async (file) => {
    try {
      const info = await stat(join(dir, file));
      if (info.size > UNTRACKED_MAX_FILE_BYTES) {
        return omittedFileStub(file, formatBytes(info.size));
      }
    } catch {}
    if (totalBytes > UNTRACKED_MAX_TOTAL_BYTES) {
      return omittedFileStub(file, "untracked diff budget exceeded");
    }
    let out = "";
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
      out = stdout;
    } catch (err: unknown) {
      const e = err as { stdout?: string };
      if (e && typeof e.stdout === "string") out = e.stdout;
    }
    totalBytes += out.length;
    return out.trim() ? out : "";
  });

  const parts = diffs.filter(Boolean);
  for (const file of overflow) {
    parts.push(omittedFileStub(file, `over ${UNTRACKED_MAX_FILES}-file limit`));
  }
  return parts.join("\n");
}

const PR_LIST_CONCURRENCY = 16;
const DIFF_CONCURRENCY = 16;

interface SwrEntry {
  value: unknown;
  fetchedAt: number;
  refresh: Promise<unknown> | null;
}

const swrStore = new Map<string, SwrEntry>();
const swrInflight = new Map<string, Promise<unknown>>();

async function swr<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const entry = swrStore.get(key);
  if (entry) {
    if (Date.now() - entry.fetchedAt > ttlMs && !entry.refresh) {
      entry.refresh = fetcher()
        .then((value) => {
          swrStore.set(key, { value, fetchedAt: Date.now(), refresh: null });
          return value;
        })
        .catch(() => {
          entry.refresh = null;
          return entry.value;
        });
    }
    return entry.value as T;
  }
  const inflight = swrInflight.get(key);
  if (inflight) return inflight as Promise<T>;
  const fetch = fetcher()
    .then((value) => {
      swrStore.set(key, { value, fetchedAt: Date.now(), refresh: null });
      swrInflight.delete(key);
      return value;
    })
    .catch((err) => {
      swrInflight.delete(key);
      throw err;
    });
  swrInflight.set(key, fetch);
  return fetch;
}

function swrInvalidate(prefix: string): void {
  for (const key of swrStore.keys()) {
    if (key.startsWith(prefix)) swrStore.delete(key);
  }
}

const PRS_TTL_MS = 30_000;
const PR_DIFF_TTL_MS = 20_000;
const PR_COMMENTS_TTL_MS = 15_000;
const MERGE_STATUS_TTL_MS = 10_000;

const GH_API = "https://api.github.com";
const GH_TOKEN_TTL_MS = 600_000;
const PRS_GRAPHQL_CHUNK = 8;

let ghTokenCache: { token: string; expiresAt: number } | null = null;
let ghTokenInflight: Promise<string> | null = null;

async function ghToken(pi: ExtensionAPI): Promise<string> {
  if (ghTokenCache && ghTokenCache.expiresAt > Date.now()) return ghTokenCache.token;
  if (ghTokenInflight) return ghTokenInflight;
  ghTokenInflight = pi
    .exec("gh", ["auth", "token"])
    .then(({ stdout }) => {
      const token = stdout.trim();
      if (!token) throw new Error("empty gh auth token");
      ghTokenCache = { token, expiresAt: Date.now() + GH_TOKEN_TTL_MS };
      ghTokenInflight = null;
      return token;
    })
    .catch((err) => {
      ghTokenInflight = null;
      throw err;
    });
  return ghTokenInflight;
}

async function ghRest(pi: ExtensionAPI, path: string, accept: string): Promise<string> {
  const token = await ghToken(pi);
  const res = await fetch(`${GH_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      "User-Agent": "pi-git-review",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} on ${path}`);
  return res.text();
}

async function ghGraphql<T>(
  pi: ExtensionAPI,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const token = await ghToken(pi);
  const res = await fetch(`${GH_API}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "pi-git-review",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}`);
  const parsed = (await res.json()) as { data?: T | null; errors?: Array<{ message?: string }> };
  if (!parsed.data) throw new Error(parsed.errors?.[0]?.message || "GraphQL error");
  return parsed.data;
}

interface GqlActor {
  login?: string | null;
}

const slugCache = new Map<string, string | null>();

async function slugForDir(pi: ExtensionAPI, dir: string): Promise<string | null> {
  const cached = slugCache.get(dir);
  if (cached !== undefined) return cached;
  let slug: string | null = null;
  try {
    const { stdout } = await pi.exec("git", ["-C", dir, "remote", "get-url", "origin"]);
    const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(stdout.trim());
    if (match) slug = `${match[1]}/${match[2]}`;
  } catch {}
  slugCache.set(dir, slug);
  return slug;
}

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

function uniqueByLabel(repos: RepoDir[]): RepoDir[] {
  const seen = new Set<string>();
  return repos.filter(({ label }) => {
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });
}

interface GqlPrNode {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  additions?: number | null;
  deletions?: number | null;
  baseRefName: string;
  headRefName: string;
  author?: GqlActor | null;
}

async function collectPullRequestsApi(pi: ExtensionAPI): Promise<PullRequestGroup[]> {
  const repos = await findRepoDirs(pi);
  const uniqueRepos = uniqueByLabel(repos);
  const withSlugs = await mapWithConcurrency(uniqueRepos, PR_LIST_CONCURRENCY, async (r) => ({
    label: r.label,
    slug: await slugForDir(pi, r.dir),
  }));
  const targets = withSlugs.filter((r): r is { label: string; slug: string } => Boolean(r.slug));
  if (!targets.length) return [];

  const chunks: Array<Array<{ label: string; slug: string }>> = [];
  for (let i = 0; i < targets.length; i += PRS_GRAPHQL_CHUNK) {
    chunks.push(targets.slice(i, i + PRS_GRAPHQL_CHUNK));
  }
  const chunkResults = await Promise.all(
    chunks.map((chunk) => {
      const parts = chunk.map(({ slug }, i) => {
        const [owner, name] = slug.split("/");
        return (
          `r${i}: repository(owner:${JSON.stringify(owner)}, name:${JSON.stringify(name)}){` +
          `pullRequests(states:OPEN, first:50, orderBy:{field:CREATED_AT, direction:DESC}){nodes{` +
          `number title url isDraft updatedAt additions deletions baseRefName headRefName author{login}}}}`
        );
      });
      return ghGraphql<Record<string, { pullRequests?: { nodes?: GqlPrNode[] } } | null>>(
        pi,
        `query{${parts.join(" ")}}`,
      );
    }),
  );

  const groups: PullRequestGroup[] = [];
  chunks.forEach((chunk, ci) => {
    chunk.forEach(({ label }, i) => {
      const nodes = chunkResults[ci][`r${i}`]?.pullRequests?.nodes || [];
      if (!nodes.length) return;
    const prs: PullRequest[] = nodes.map((p) => ({
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
    });
  });
  groups.sort((a, b) => a.repo.localeCompare(b.repo));
  return groups;
}

async function collectPullRequests(pi: ExtensionAPI): Promise<PullRequestGroup[]> {
  try {
    return await collectPullRequestsApi(pi);
  } catch {
    return collectPullRequestsCli(pi);
  }
}

async function collectPullRequestsCli(pi: ExtensionAPI): Promise<PullRequestGroup[]> {
  const repos = await findRepoDirs(pi);
  const uniqueRepos = uniqueByLabel(repos);

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

interface PrView {
  number: number;
  title: string;
  author?: { login?: string | null } | null;
  url: string;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  body: string;
}

async function collectPrDiff(
  pi: ExtensionAPI,
  repo: string,
  prNumber: number,
): Promise<{ files: parseDiff.File[]; context: PrContext } | null> {
  const repos = await findRepoDirs(pi);
  const dir = repoDirForLabel(repos, repo);
  if (!dir) return null;
  try {
    return await collectPrDiffApi(pi, repo, dir, prNumber);
  } catch {
    return collectPrDiffCli(pi, repo, dir, prNumber);
  }
}

async function collectPrDiffApi(
  pi: ExtensionAPI,
  repo: string,
  dir: string,
  prNumber: number,
): Promise<{ files: parseDiff.File[]; context: PrContext }> {
  const slug = await slugForDir(pi, dir);
  if (!slug) throw new Error("no github slug for dir");
  const [owner, name] = slug.split("/");
  const query =
    `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){` +
    `pullRequest(number:$number){number title url baseRefName headRefName headRefOid body author{login}}}}`;
  const [data, diffOut] = await Promise.all([
    ghGraphql<{ repository?: { pullRequest?: (Omit<PrView, "author"> & { author?: GqlActor | null }) | null } | null }>(
      pi,
      query,
      { owner, name, number: prNumber },
    ),
    ghRest(pi, `/repos/${slug}/pulls/${prNumber}`, "application/vnd.github.diff"),
  ]);
  const pr = data.repository?.pullRequest;
  if (!pr) throw new Error("PR not found");
  return buildPrDiffResult(repo, { ...pr, author: { login: pr.author?.login || undefined } }, diffOut);
}

async function collectPrDiffCli(
  pi: ExtensionAPI,
  repo: string,
  dir: string,
  prNumber: number,
): Promise<{ files: parseDiff.File[]; context: PrContext }> {
  const [{ stdout: viewOut }, { stdout: diffOut }] = await Promise.all([
    pi.exec("gh", [
      "pr",
      "view",
      String(prNumber),
      "--json",
      "number,title,author,url,baseRefName,headRefName,headRefOid,body",
    ], { cwd: dir }),
    pi.exec("gh", ["pr", "diff", String(prNumber)], { cwd: dir }),
  ]);
  return buildPrDiffResult(repo, JSON.parse(viewOut) as PrView, diffOut);
}

function buildPrDiffResult(
  repo: string,
  view: PrView,
  diffOut: string,
): { files: parseDiff.File[]; context: PrContext } {
  const prefix = repo === "." ? "" : repo + "/";
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

async function repoSlugForDir(
  pi: ExtensionAPI,
  repo: string,
  dir: string,
  prNumber: number,
): Promise<string | null> {
  const slug = await slugForDir(pi, dir);
  if (slug) return slug;
  const url = await prUrlForNumber(pi, repo, prNumber);
  return url ? repoSlugFromUrl(url) : null;
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
  try {
    return await collectPrCommentsApi(pi, dir, prNumber);
  } catch {
    return collectPrCommentsCli(pi, repo, dir, prNumber);
  }
}

interface GqlCommentNode {
  databaseId?: number | null;
  body?: string | null;
  createdAt: string;
  url: string;
  author?: GqlActor | null;
}

interface GqlPageInfo {
  hasNextPage: boolean;
  endCursor?: string | null;
}

interface GqlThreadNode {
  isResolved: boolean;
  isOutdated: boolean;
  path?: string | null;
  line?: number | null;
  startLine?: number | null;
  diffSide?: string | null;
  comments?: { nodes?: GqlCommentNode[] };
}

interface GqlCommentsResponse {
  repository?: {
    pullRequest?: {
      reviewThreads?: { pageInfo?: GqlPageInfo; nodes?: GqlThreadNode[] };
      comments?: { pageInfo?: GqlPageInfo; nodes?: GqlCommentNode[] };
    } | null;
  } | null;
}

async function collectPrCommentsApi(
  pi: ExtensionAPI,
  dir: string,
  prNumber: number,
): Promise<{ threads: PrCommentThread[] }> {
  const slug = await slugForDir(pi, dir);
  if (!slug) throw new Error("no github slug for dir");
  const [owner, name] = slug.split("/");

  const reviewThreads: PrCommentThread[] = [];
  const conversation: GqlCommentNode[] = [];
  let threadCursor: string | null = null;
  let commentCursor: string | null = null;
  let wantThreads: boolean = true;
  let wantComments: boolean = true;

  while (wantThreads || wantComments) {
    const query: string =
      `query($owner:String!,$name:String!,$number:Int!,$tc:String,$cc:String){` +
      `repository(owner:$owner,name:$name){pullRequest(number:$number){` +
      (wantThreads
        ? `reviewThreads(first:50,after:$tc){pageInfo{hasNextPage endCursor} nodes{` +
          `isResolved isOutdated path line startLine diffSide ` +
          `comments(first:100){nodes{databaseId body createdAt url author{login}}}}} `
        : "") +
      (wantComments
        ? `comments(first:100,after:$cc){pageInfo{hasNextPage endCursor} nodes{` +
          `databaseId body createdAt url author{login}}}`
        : "") +
      `}}}`;
    const data: GqlCommentsResponse = await ghGraphql<GqlCommentsResponse>(pi, query, {
      owner,
      name,
      number: prNumber,
      tc: threadCursor,
      cc: commentCursor,
    });

    const pr: NonNullable<NonNullable<GqlCommentsResponse["repository"]>["pullRequest"]> | null | undefined =
      data.repository?.pullRequest;
    if (!pr) throw new Error("PR not found");

    if (wantThreads) {
      for (const node of pr.reviewThreads?.nodes || []) {
        const comments = (node.comments?.nodes || []).filter((c) => c.databaseId != null);
        if (!comments.length) continue;
        reviewThreads.push({
          id: String(comments[0].databaseId),
          kind: "review",
          path: node.path ?? undefined,
          line: node.line ?? undefined,
          startLine: node.startLine ?? undefined,
          side: node.diffSide === "LEFT" ? "LEFT" : node.diffSide === "RIGHT" ? "RIGHT" : undefined,
          isResolved: Boolean(node.isResolved),
          isOutdated: Boolean(node.isOutdated),
          htmlUrl: comments[0].url,
          comments: comments.map((c) => ({
            id: c.databaseId as number,
            author: c.author?.login || "unknown",
            body: stripHtmlComments(c.body || ""),
            createdAt: c.createdAt,
            htmlUrl: c.url,
          })),
        });
      }
      const info: GqlPageInfo | undefined = pr.reviewThreads?.pageInfo;
      wantThreads = Boolean(info?.hasNextPage && info?.endCursor);
      threadCursor = info?.endCursor || null;
    }

    if (wantComments) {
      conversation.push(...(pr.comments?.nodes || []).filter((c) => c.databaseId != null));
      const info: GqlPageInfo | undefined = pr.comments?.pageInfo;
      wantComments = Boolean(info?.hasNextPage && info?.endCursor);
      commentCursor = info?.endCursor || null;
    }
  }

  reviewThreads.sort((a, b) => {
    const pathCmp = (a.path || "").localeCompare(b.path || "");
    if (pathCmp !== 0) return pathCmp;
    return (a.line || 0) - (b.line || 0);
  });

  const conversationThreads: PrCommentThread[] = conversation
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((c) => ({
      id: `issue-${c.databaseId}`,
      kind: "conversation" as const,
      isResolved: false,
      isOutdated: false,
      htmlUrl: c.url,
      comments: [
        {
          id: c.databaseId as number,
          author: c.author?.login || "unknown",
          body: stripHtmlComments(c.body || ""),
          createdAt: c.createdAt,
          htmlUrl: c.url,
        },
      ],
    }));

  return { threads: [...reviewThreads, ...conversationThreads] };
}

async function collectPrCommentsCli(
  pi: ExtensionAPI,
  repo: string,
  dir: string,
  prNumber: number,
): Promise<{ threads: PrCommentThread[] }> {
  const slug = await repoSlugForDir(pi, repo, dir, prNumber);
  if (!slug) return { threads: [] };
  const [owner, name] = slug.split("/");

  const [reviewComments, issueComments, threadState] = await Promise.all([
    fetchReviewComments(pi, dir, slug, prNumber),
    fetchIssueComments(pi, dir, slug, prNumber),
    fetchReviewThreadState(pi, dir, owner, name, prNumber),
  ]);

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
  const slug = await repoSlugForDir(pi, repo, dir, prNumber);
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
  const slug = await repoSlugForDir(pi, repo, dir, prNumber);
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
  try {
    return await collectMergeStatusApi(pi, dir, prNumber);
  } catch {
    return collectMergeStatusCli(pi, dir, prNumber);
  }
}

async function collectMergeStatusApi(
  pi: ExtensionAPI,
  dir: string,
  prNumber: number,
): Promise<MergeStatus> {
  const slug = await slugForDir(pi, dir);
  if (!slug) throw new Error("no github slug for dir");
  const [owner, name] = slug.split("/");
  const query =
    `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){` +
    `viewerPermission pullRequest(number:$number){state mergeable mergeStateStatus isDraft}}}`;
  const data = await ghGraphql<{
    repository?: {
      viewerPermission?: string | null;
      pullRequest?: {
        state?: string | null;
        mergeable?: string | null;
        mergeStateStatus?: string | null;
        isDraft?: boolean | null;
      } | null;
    } | null;
  }>(pi, query, { owner, name, number: prNumber });
  const pr = data.repository?.pullRequest;
  if (!pr) throw new Error("PR not found");
  const viewerPermission = data.repository?.viewerPermission || "";
  return {
    state: pr.state || "UNKNOWN",
    mergeable: pr.mergeable || "UNKNOWN",
    mergeStateStatus: pr.mergeStateStatus || "UNKNOWN",
    isDraft: Boolean(pr.isDraft),
    viewerPermission,
    canAdmin: viewerPermission === "ADMIN",
  };
}

async function collectMergeStatusCli(
  pi: ExtensionAPI,
  dir: string,
  prNumber: number,
): Promise<MergeStatus> {
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
          const groups = await swr("prs", PRS_TTL_MS, () => collectPullRequests(pi));
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
          const result = await swr(`pr-diff:${repo}#${number}`, PR_DIFF_TTL_MS, () =>
            collectPrDiff(pi, repo, number),
          );
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
          const result = await swr(`pr-comments:${repo}#${number}`, PR_COMMENTS_TTL_MS, () =>
            collectPrComments(pi, repo, number),
          );
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
          swrInvalidate(`pr-comments:${repo}#${number}`);
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
          swrInvalidate(`pr-comments:${repo}#${number}`);
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
          const status = await swr(`merge-status:${repo}#${number}`, MERGE_STATUS_TTL_MS, () =>
            collectMergeStatus(pi, repo, number),
          );
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
          swrInvalidate("prs");
          swrInvalidate(`pr-diff:${repo}#${number}`);
          swrInvalidate(`merge-status:${repo}#${number}`);
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
        warmPrs() {
          swr("prs", PRS_TTL_MS, () => collectPullRequests(pi)).catch(() => {});
        },
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
