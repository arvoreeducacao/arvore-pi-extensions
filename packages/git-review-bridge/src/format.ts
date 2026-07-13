export interface ReviewComment {
  type: "comment";
  file: string;
  startLine?: number;
  endLine?: number;
  code?: string;
  question: string;
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

export type ReviewPayload =
  | ReviewComment
  | PrContext
  | CommentThreadMessage
  | CommentBatchMessage;

function repoSlugFromUrl(url: string): string | null {
  const match = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(url);
  return match ? match[1] : null;
}

function formatComment(c: ReviewComment): string {
  const lines: string[] = [];
  const location =
    c.startLine && c.endLine && c.startLine !== c.endLine
      ? `${c.file} (lines ${c.startLine}-${c.endLine})`
      : c.startLine
        ? `${c.file} (line ${c.startLine})`
        : c.file;

  lines.push(`Code review question about ${location}:`);
  lines.push("");
  if (c.code?.trim()) {
    lines.push("```");
    lines.push(c.code.replace(/```/g, "ʼʼʼ"));
    lines.push("```");
    lines.push("");
  }
  lines.push(c.question.trim());
  return lines.join("\n");
}

function formatPrContext(c: PrContext): string {
  const lines: string[] = [];
  lines.push(`I'm reviewing a pull request. Here is the context for the questions that follow:`);
  lines.push("");
  lines.push(`- Repo: ${c.repo}`);
  lines.push(`- PR #${c.number}: ${c.title}`);
  lines.push(`- Author: ${c.author}`);
  lines.push(`- Branch: ${c.headRefName} → ${c.baseRefName}`);
  lines.push(`- Link: ${c.url}`);
  lines.push("");
  if (c.body.trim()) {
    lines.push("Description:");
    lines.push("");
    lines.push(c.body.trim().replace(/```/g, "ʼʼʼ"));
  } else {
    lines.push("(No description provided.)");
  }
  lines.push("");
  const slug = repoSlugFromUrl(c.url);
  const repoFlag = slug ? ` -R ${slug}` : "";
  lines.push(
    `I'll ask about specific lines next. Use \`gh pr view ${c.number}${repoFlag}\` or \`gh pr diff ${c.number}${repoFlag}\` if you need more than the snippets I send.`,
  );
  return lines.join("\n");
}

function threadLocation(t: PrCommentThread): string {
  if (t.kind === "conversation") return "PR conversation";
  if (!t.path) return "unknown location";
  if (t.startLine && t.line && t.startLine !== t.line) {
    return `${t.path}:${t.startLine}-${t.line}`;
  }
  if (t.line) return `${t.path}:${t.line}`;
  return t.path;
}

function renderThread(t: PrCommentThread): string {
  const lines: string[] = [];
  const tags: string[] = [];
  if (t.isResolved) tags.push("resolved");
  if (t.isOutdated) tags.push("outdated");
  const suffix = tags.length ? ` (${tags.join(", ")})` : "";
  const kind = t.kind === "review" ? "review comment" : "conversation comment";
  const lead = t.comments[0];
  lines.push(`GitHub ${kind} on ${threadLocation(t)}${suffix} — thread by @${lead?.author || "unknown"}:`);
  lines.push("");
  for (const c of t.comments) {
    lines.push(`@${c.author}:`);
    lines.push("```");
    lines.push(c.body.replace(/```/g, "\u02bc\u02bc\u02bc"));
    lines.push("```");
    lines.push("");
  }
  lines.push(`Link: ${t.htmlUrl}`);
  return lines.join("\n").trim();
}

function formatCommentThread(msg: CommentThreadMessage): string {
  const lines: string[] = [];
  lines.push(`I'm looking at a GitHub PR comment (repo ${msg.repo}, PR #${msg.number}).`);
  lines.push("");
  lines.push(renderThread(msg.thread));
  if (msg.question?.trim()) {
    lines.push("");
    lines.push("My question:");
    lines.push("");
    lines.push(msg.question.trim());
  }
  return lines.join("\n");
}

function formatCommentBatch(msg: CommentBatchMessage): string {
  const lines: string[] = [];
  lines.push(
    `I'm sending a batch of ${msg.threads.length} GitHub PR comment thread(s) (repo ${msg.repo}, PR #${msg.number}).`,
  );
  lines.push("");
  if (msg.note?.trim()) {
    lines.push("My note:");
    lines.push("");
    lines.push(msg.note.trim());
    lines.push("");
  }
  msg.threads.forEach((t, i) => {
    lines.push(`--- Comment ${i + 1} of ${msg.threads.length} ---`);
    lines.push("");
    lines.push(renderThread(t));
    lines.push("");
  });
  return lines.join("\n").trim();
}

export function formatReviewPayload(msg: ReviewPayload): string {
  switch (msg.type) {
    case "pr_context":
      return formatPrContext(msg);
    case "comment_thread":
      return formatCommentThread(msg);
    case "comment_batch":
      return formatCommentBatch(msg);
    default:
      return formatComment(msg);
  }
}
