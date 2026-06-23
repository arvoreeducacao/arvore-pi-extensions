import { platform } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { WebSocket } from "ws";
import {
  startGitReviewServer,
  type DiffScope,
  type GitReviewServer,
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
const USAGE = "Usage: /review [working|staged|branch [base]]";

function parseScopeArgs(args: string): { scope: DiffScope; base: string; error?: string } {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { scope: "working", base: "main" };
  const scopeArg = parts[0].toLowerCase() as DiffScope;
  if (!(VALID_SCOPES as readonly string[]).includes(scopeArg)) {
    return { scope: "working", base: "main", error: `Unknown scope "${parts[0]}". ${USAGE}` };
  }
  return { scope: scopeArg, base: parts[1] || "main" };
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

export default function (pi: ExtensionAPI) {
  let server: GitReviewServer | null = null;
  const clients: Set<WebSocket> = new Set();
  let isIdle: () => boolean = () => true;

  const handleComment = (comment: ReviewComment) => {
    const message = formatComment(comment);
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
        server = await startGitReviewServer(port, pi, clients, handleComment);
        return server;
      } catch {}
    }
    ctx.ui.notify("git-review: no available port in range", "warning");
    return null;
  }

  pi.registerCommand("review", {
    description:
      "Open a browser-based git diff reviewer. Usage: /review [working|staged|branch [base]]",
    handler: async (args, ctx) => {
      isIdle = () => ctx.isIdle();
      if (!ctx.hasUI) {
        ctx.ui.notify("git-review needs an interactive session", "warning");
        return;
      }

      const { scope, base, error } = parseScopeArgs(args);
      if (error) {
        ctx.ui.notify(error, "error");
        return;
      }

      const srv = await ensureServer(ctx);
      if (!srv) return;
      const url = `${srv.url}&scope=${scope}&base=${encodeURIComponent(base)}`;
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
