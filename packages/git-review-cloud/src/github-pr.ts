import parseDiff from "parse-diff";
import { installationToken } from "./github-app.js";

const GH_API = "https://api.github.com";

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

export type MergeMethod = "merge" | "squash" | "rebase";

export interface MergeStatus {
  state: string;
  mergeable: string;
  mergeStateStatus: string;
  isDraft: boolean;
  viewerPermission: string;
  canAdmin: boolean;
}

function ownerOf(slug: string): string {
  return slug.split("/")[0];
}

async function rest(slug: string, path: string, init: RequestInit = {}, accept = "application/vnd.github+json"): Promise<Response> {
  const token = await installationToken(ownerOf(slug));
  return fetch(`${GH_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      "User-Agent": "git-review-cloud",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
}

async function restJson<T>(slug: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await rest(slug, path, init);
  if (!res.ok) throw new Error(`GitHub REST ${res.status} on ${path}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function graphql<T>(slug: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const token = await installationToken(ownerOf(slug));
  const res = await fetch(`${GH_API}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "git-review-cloud",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}`);
  const parsed = (await res.json()) as { data?: T | null; errors?: Array<{ message?: string }> };
  if (!parsed.data) throw new Error(parsed.errors?.[0]?.message || "GraphQL error");
  return parsed.data;
}

function stripHtmlComments(body: string): string {
  return (body || "").replace(/<!--[\s\S]*?-->/g, "").trim();
}

export async function searchOpenPullRequests(org: string): Promise<PullRequestGroup[]> {
  const token = await installationToken(org);
  const byRepo = new Map<string, PullRequest[]>();
  let page = 1;
  for (;;) {
    const q = encodeURIComponent(`is:open is:pr org:${org}`);
    const res = await fetch(
      `${GH_API}/search/issues?q=${q}&per_page=100&page=${page}&sort=updated&order=desc`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "git-review-cloud",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!res.ok) throw new Error(`GitHub search ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      total_count?: number;
      items?: Array<{
        number: number;
        title: string;
        user?: { login?: string };
        html_url: string;
        draft?: boolean;
        updated_at: string;
        repository_url: string;
      }>;
    };
    const items = data.items || [];
    for (const it of items) {
      const slug = it.repository_url.replace(`${GH_API}/repos/`, "");
      const arr = byRepo.get(slug) || [];
      arr.push({
        repo: slug,
        number: it.number,
        title: it.title,
        author: it.user?.login || "unknown",
        url: it.html_url,
        baseRefName: "",
        headRefName: "",
        isDraft: Boolean(it.draft),
        updatedAt: it.updated_at,
        additions: 0,
        deletions: 0,
      });
      byRepo.set(slug, arr);
    }
    if (items.length < 100 || page >= 10) break;
    page += 1;
  }
  return [...byRepo.entries()]
    .map(([repo, prs]) => ({ repo, prs }))
    .sort((a, b) => a.repo.localeCompare(b.repo));
}

export async function listPullRequests(slug: string): Promise<PullRequestGroup> {
  const [owner, name] = slug.split("/");
  const prs = await restJson<
    Array<{
      number: number;
      title: string;
      user?: { login?: string };
      html_url: string;
      base: { ref: string };
      head: { ref: string };
      draft?: boolean;
      updated_at: string;
      additions?: number;
      deletions?: number;
    }>
  >(slug, `/repos/${owner}/${name}/pulls?state=open&per_page=100`);
  return {
    repo: slug,
    prs: prs.map((p) => ({
      repo: slug,
      number: p.number,
      title: p.title,
      author: p.user?.login || "unknown",
      url: p.html_url,
      baseRefName: p.base.ref,
      headRefName: p.head.ref,
      isDraft: Boolean(p.draft),
      updatedAt: p.updated_at,
      additions: p.additions ?? 0,
      deletions: p.deletions ?? 0,
    })),
  };
}

export async function getPrDiff(
  slug: string,
  prNumber: number,
): Promise<{ files: parseDiff.File[]; context: PrContext }> {
  const [owner, name] = slug.split("/");
  const query =
    `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){` +
    `pullRequest(number:$number){number title url baseRefName headRefName headRefOid body author{login}}}}`;
  const [data, diffRes] = await Promise.all([
    graphql<{
      repository?: {
        pullRequest?: {
          number: number;
          title: string;
          url: string;
          baseRefName: string;
          headRefName: string;
          headRefOid: string;
          body: string;
          author?: { login?: string } | null;
        } | null;
      } | null;
    }>(slug, query, { owner, name, number: prNumber }),
    rest(slug, `/repos/${owner}/${name}/pulls/${prNumber}`, {}, "application/vnd.github.diff"),
  ]);
  const pr = data.repository?.pullRequest;
  if (!pr) throw new Error("pull request not found");
  if (!diffRes.ok) throw new Error(`GitHub diff ${diffRes.status}`);
  const files = parseDiff(await diffRes.text());
  const context: PrContext = {
    type: "pr_context",
    repo: slug,
    number: pr.number,
    title: pr.title,
    author: pr.author?.login || "unknown",
    url: pr.url,
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    headRefOid: pr.headRefOid,
    body: pr.body || "",
  };
  return { files, context };
}

interface ThreadState {
  isResolved: boolean;
  isOutdated: boolean;
}

interface ReviewThreadStateResponse {
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
    } | null;
  } | null;
}

async function reviewThreadState(slug: string, prNumber: number): Promise<Map<number, ThreadState>> {
  const [owner, name] = slug.split("/");
  const state = new Map<number, ThreadState>();
  let cursor: string | null = null;
  let hasNext = true;
  while (hasNext) {
    const query =
      `query($owner:String!,$name:String!,$number:Int!,$cursor:String){` +
      `repository(owner:$owner,name:$name){pullRequest(number:$number){` +
      `reviewThreads(first:100,after:$cursor){pageInfo{hasNextPage endCursor} nodes{isResolved isOutdated ` +
      `comments(first:100){nodes{databaseId}}}}}}}`;
    const data: ReviewThreadStateResponse = await graphql<ReviewThreadStateResponse>(slug, query, {
      owner,
      name,
      number: prNumber,
      cursor,
    });
    const threads = data.repository?.pullRequest?.reviewThreads;
    for (const node of threads?.nodes || []) {
      const ts: ThreadState = { isResolved: node.isResolved, isOutdated: node.isOutdated };
      for (const c of node.comments?.nodes || []) state.set(c.databaseId, ts);
    }
    hasNext = Boolean(threads?.pageInfo?.hasNextPage && threads?.pageInfo?.endCursor);
    cursor = threads?.pageInfo?.endCursor || null;
  }
  return state;
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

async function paginate<T>(slug: string, path: string): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const batch = await restJson<T[]>(slug, `${path}${sep}per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return out;
}

export async function getPrComments(slug: string, prNumber: number): Promise<{ threads: PrCommentThread[] }> {
  const [owner, name] = slug.split("/");
  const [reviewComments, issueComments, state] = await Promise.all([
    paginate<RawReviewComment>(slug, `/repos/${owner}/${name}/pulls/${prNumber}/comments`),
    paginate<RawIssueComment>(slug, `/repos/${owner}/${name}/issues/${prNumber}/comments`),
    reviewThreadState(slug, prNumber),
  ]);
  const threads = [
    ...buildReviewThreads(reviewComments, state),
    ...buildConversationThreads(issueComments),
  ];
  return { threads };
}

export async function postReviewComment(
  slug: string,
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
  const [owner, name] = slug.split("/");
  const body: Record<string, unknown> = {
    body: input.body,
    commit_id: input.commitId,
    path: input.path,
    line: input.line,
    side: input.side || "RIGHT",
  };
  if (input.startLine && input.startLine !== input.line) {
    body.start_line = input.startLine;
    body.start_side = input.startSide || input.side || "RIGHT";
  }
  const res = await restJson<{ html_url?: string }>(slug, `/repos/${owner}/${name}/pulls/${prNumber}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { htmlUrl: res.html_url || "" };
}

export async function replyToComment(
  slug: string,
  prNumber: number,
  commentId: number,
  body: string,
): Promise<{ htmlUrl: string }> {
  const [owner, name] = slug.split("/");
  const res = await restJson<{ html_url?: string }>(
    slug,
    `/repos/${owner}/${name}/pulls/${prNumber}/comments/${commentId}/replies`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    },
  );
  return { htmlUrl: res.html_url || "" };
}

export async function getMergeStatus(slug: string, prNumber: number, viewerLogin: string): Promise<MergeStatus> {
  const [owner, name] = slug.split("/");
  const query =
    `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){` +
    `viewerPermission pullRequest(number:$number){state mergeable mergeStateStatus isDraft}}}`;
  const data = await graphql<{
    repository?: {
      viewerPermission?: string | null;
      pullRequest?: {
        state?: string;
        mergeable?: string;
        mergeStateStatus?: string;
        isDraft?: boolean;
      } | null;
    } | null;
  }>(slug, query, { owner, name, number: prNumber });
  const pr = data.repository?.pullRequest;
  const perm = await repoPermissionForUser(slug, viewerLogin).catch(() => "");
  return {
    state: pr?.state || "UNKNOWN",
    mergeable: pr?.mergeable || "UNKNOWN",
    mergeStateStatus: pr?.mergeStateStatus || "UNKNOWN",
    isDraft: Boolean(pr?.isDraft),
    viewerPermission: perm,
    canAdmin: perm === "admin" || perm === "ADMIN",
  };
}

async function repoPermissionForUser(slug: string, login: string): Promise<string> {
  if (!login) return "";
  const [owner, name] = slug.split("/");
  const data = await restJson<{ permission?: string }>(
    slug,
    `/repos/${owner}/${name}/collaborators/${login}/permission`,
  );
  return data.permission || "";
}

export async function mergePullRequest(
  slug: string,
  prNumber: number,
  opts: { method: MergeMethod },
): Promise<{ ok: true }> {
  const [owner, name] = slug.split("/");
  const res = await rest(slug, `/repos/${owner}/${name}/pulls/${prNumber}/merge`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ merge_method: opts.method }),
  });
  if (!res.ok) throw new Error(`merge failed: ${res.status} ${await res.text()}`);
  return { ok: true };
}
