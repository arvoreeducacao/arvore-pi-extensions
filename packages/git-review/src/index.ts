import { platform } from "node:os";
import { tmpdir } from "node:os";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { WebSocket } from "ws";
import {
  startGitReviewServer,
  type DiffScope,
  type GitReviewServer,
  type PrContext,
  type ReviewComment,
  type CommentThreadMessage,
  type CommentBatchMessage,
  type PrCommentThread,
  type IncomingMessage_,
} from "./server.js";

const PORT_RANGE_START = 9890;
const PORT_RANGE_END = 9899;

const DISCOVERY_FILE = join(tmpdir(), `pi-git-review-${process.pid}.json`);
const REQUEST_FILE = join(tmpdir(), `pi-git-review-request-${process.pid}.json`);
const REQUEST_POLL_MS = 1_000;

function publishServerInfo(srv: { url: string; token: string; port: number }): void {
  try {
    writeFileSync(
      DISCOVERY_FILE,
      JSON.stringify({
        pid: process.pid,
        port: srv.port,
        token: srv.token,
        baseUrl: `http://127.0.0.1:${srv.port}`,
        url: srv.url,
        ts: Date.now(),
      }),
      { mode: 0o600 },
    );
  } catch {}
}

function unpublishServerInfo(): void {
  try {
    unlinkSync(DISCOVERY_FILE);
  } catch {}
}

function consumeServerRequest(): boolean {
  if (!existsSync(REQUEST_FILE)) return false;
  try {
    unlinkSync(REQUEST_FILE);
  } catch {}
  return true;
}

function openBrowser(pi: ExtensionAPI, url: string): void {
  const opener =
    platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  pi.exec(opener, args).catch(() => {});
}

const VALID_SCOPES = ["working", "staged", "branch"] as const;
const USAGE = "Usage: /review [<pr-number> | working|staged|branch [base] | prs]";

function parseScopeArgs(args: string): {
  mode: "diff" | "prs";
  scope: DiffScope;
  base: string;
  prNumber?: number;
  error?: string;
} {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { mode: "diff", scope: "working", base: "main" };
  const first = parts[0].toLowerCase();
  if (first === "prs" || first === "pr") {
    return { mode: "prs", scope: "working", base: "main" };
  }
  if (/^#?\d+$/.test(first)) {
    return { mode: "prs", scope: "working", base: "main", prNumber: Number(first.replace(/^#/, "")) };
  }
  const scopeArg = first as DiffScope;
  if (!(VALID_SCOPES as readonly string[]).includes(scopeArg)) {
    return {
      mode: "diff",
      scope: "working",
      base: "main",
      error: `Unknown scope "${parts[0]}". ${USAGE}`,
    };
  }
  return { mode: "diff", scope: scopeArg, base: parts[1] || "main" };
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

function repoSlugFromUrl(url: string): string | null {
  const match = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(url);
  return match ? match[1] : null;
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

export default function (pi: ExtensionAPI) {
  let server: GitReviewServer | null = null;
  const clients: Set<WebSocket> = new Set();
  let isIdle: () => boolean = () => true;
  let requestTimer: ReturnType<typeof setInterval> | null = null;
  let serverStarting = false;

  const handleMessage = (msg: IncomingMessage_) => {
    let message: string;
    switch (msg.type) {
      case "pr_context":
        message = formatPrContext(msg);
        break;
      case "comment_thread":
        message = formatCommentThread(msg);
        break;
      case "comment_batch":
        message = formatCommentBatch(msg);
        break;
      default:
        message = formatComment(msg);
    }
    if (isIdle()) {
      pi.sendUserMessage(message);
    } else {
      pi.sendUserMessage(message, { deliverAs: "steer" });
    }
  };

  async function ensureServer(ctx: {
    ui: { notify: (m: string, type?: "error" | "warning" | "info") => void };
  }): Promise<GitReviewServer | null> {
    if (server) return server;
    if (serverStarting) return null;
    serverStarting = true;
    try {
      for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
        try {
          server = await startGitReviewServer(port, pi, clients, handleMessage);
          publishServerInfo(server);
          return server;
        } catch {}
      }
      ctx.ui.notify("git-review: no available port in range", "warning");
      return null;
    } finally {
      serverStarting = false;
    }
  }

  function startRequestWatcher(ctx: {
    ui: { notify: (m: string, type?: "error" | "warning" | "info") => void };
  }): void {
    if (requestTimer) return;
    requestTimer = setInterval(() => {
      if (server || serverStarting) return;
      if (!consumeServerRequest()) return;
      void ensureServer(ctx);
    }, REQUEST_POLL_MS);
    if (typeof requestTimer.unref === "function") requestTimer.unref();
  }

  function stopRequestWatcher(): void {
    if (requestTimer) {
      clearInterval(requestTimer);
      requestTimer = null;
    }
  }

  pi.registerCommand("review", {
    description:
      "Open a browser-based git diff & PR reviewer. Usage: /review [<pr-number> | working|staged|branch [base] | prs]",
    handler: async (args, ctx) => {
      isIdle = () => ctx.isIdle();
      if (!ctx.hasUI) {
        ctx.ui.notify("git-review needs an interactive session", "warning");
        return;
      }

      const { mode, scope, base, prNumber, error } = parseScopeArgs(args);
      if (error) {
        ctx.ui.notify(error, "error");
        return;
      }

      const srv = await ensureServer(ctx);
      if (!srv) return;
      const url =
        mode === "prs"
          ? `${srv.url}&mode=prs${prNumber ? `&pr=${prNumber}` : ""}`
          : `${srv.url}&scope=${scope}&base=${encodeURIComponent(base)}`;
      openBrowser(pi, url);
      ctx.ui.notify(
        `git-review open at ${srv.url} — comments arrive in this terminal.`,
        "info",
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    isIdle = () => ctx.isIdle();
    startRequestWatcher(ctx);
  });

  pi.on("session_shutdown", async () => {
    stopRequestWatcher();
    consumeServerRequest();
    unpublishServerInfo();
    server?.close();
    server = null;
  });
}
