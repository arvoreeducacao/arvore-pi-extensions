import { platform } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { WebSocket } from "ws";
import {
  startGitReviewServer,
  type DiffScope,
  type GitReviewServer,
  type PrContext,
  type ReviewComment,
} from "./server.js";

const PORT_RANGE_START = 9890;
const PORT_RANGE_END = 9899;

function openBrowser(pi: ExtensionAPI, url: string): void {
  const opener =
    platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  pi.exec(opener, args).catch(() => {});
}

const VALID_SCOPES = ["working", "staged", "branch"] as const;
const USAGE = "Usage: /review [working|staged|branch [base] | prs]";

function parseScopeArgs(args: string): {
  mode: "diff" | "prs";
  scope: DiffScope;
  base: string;
  error?: string;
} {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { mode: "diff", scope: "working", base: "main" };
  const first = parts[0].toLowerCase();
  if (first === "prs" || first === "pr") {
    return { mode: "prs", scope: "working", base: "main" };
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

export default function (pi: ExtensionAPI) {
  let server: GitReviewServer | null = null;
  const clients: Set<WebSocket> = new Set();
  let isIdle: () => boolean = () => true;

  const handleMessage = (msg: ReviewComment | PrContext) => {
    const message = msg.type === "pr_context" ? formatPrContext(msg) : formatComment(msg);
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
    for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
      try {
        server = await startGitReviewServer(port, pi, clients, handleMessage);
        return server;
      } catch {}
    }
    ctx.ui.notify("git-review: no available port in range", "warning");
    return null;
  }

  pi.registerCommand("review", {
    description:
      "Open a browser-based git diff & PR reviewer. Usage: /review [working|staged|branch [base] | prs]",
    handler: async (args, ctx) => {
      isIdle = () => ctx.isIdle();
      if (!ctx.hasUI) {
        ctx.ui.notify("git-review needs an interactive session", "warning");
        return;
      }

      const { mode, scope, base, error } = parseScopeArgs(args);
      if (error) {
        ctx.ui.notify(error, "error");
        return;
      }

      const srv = await ensureServer(ctx);
      if (!srv) return;
      const url =
        mode === "prs"
          ? `${srv.url}&mode=prs`
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
  });

  pi.on("session_shutdown", async () => {
    server?.close();
    server = null;
  });
}
