import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runOrca, isOrcaSession } from "./core.js";

interface TerminalCreateResult {
  terminal?: { handle?: string; id?: string; title?: string };
  handle?: string;
}

function terminalHandle(r: any): string | undefined {
  return r?.terminal?.handle || r?.terminal?.id || r?.handle || r?.id;
}

export function registerTerminalTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "orca_terminal_start",
    label: "Orca Terminal Start",
    description:
      "Start a long-running command in a visible, persistent Orca terminal tab (dev server, watch, migrations, tunnels). The terminal survives the pi session and is visible in the Orca UI. Returns a terminal handle to use with orca_terminal_read / orca_terminal_wait / orca_terminal_stop. Use this instead of bash for processes that should keep running in the background.",
    promptSnippet: "Start a long-running job in an Orca terminal",
    promptGuidelines: [
      "Use `orca_terminal_start` (not `bash`) for long-running processes like dev servers, watchers, and migrations when running inside an Orca session.",
      "Capture the returned `handle` and poll output with `orca_terminal_read` using the `cursor` from the previous read to get only new lines.",
      "Use `orca_terminal_wait` with `for: tui-idle` to wait until a dev server is ready, or `for: exit` for one-shot commands.",
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Command to run on terminal startup (e.g. 'pnpm dev')" }),
      title: Type.Optional(Type.String({ description: "Custom title for the terminal tab" })),
      worktree: Type.Optional(Type.String({ description: "Worktree selector (default: active). E.g. active, path:/abs/path, name:foo" })),
      focus: Type.Optional(Type.Boolean({ description: "Reveal/switch to the terminal in the Orca UI (default false)" })),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) {
        return { content: [{ type: "text", text: "Not running inside an Orca session; use bash instead." }], details: {} };
      }
      const args = ["terminal", "create", "--worktree", params.worktree || "active", "--command", params.command];
      if (params.title) args.push("--title", params.title);
      if (params.focus) args.push("--focus");
      const r = runOrca<TerminalCreateResult>(args);
      if (!r.ok) return { content: [{ type: "text", text: `Failed to start terminal: ${r.error}` }], details: {} };
      const handle = terminalHandle(r.result);
      return {
        content: [{ type: "text", text: `Started terminal ${handle ? `(handle: ${handle})` : ""} running: ${params.command}` }],
        details: { handle, ...r.result },
      };
    },
  });

  pi.registerTool({
    name: "orca_terminal_read",
    label: "Orca Terminal Read",
    description:
      "Read bounded output from an Orca terminal. Pass the cursor returned by a previous read to get only new output since then. Omit the handle to read the active terminal in the current worktree.",
    promptSnippet: "Read output from an Orca terminal",
    parameters: Type.Object({
      handle: Type.Optional(Type.String({ description: "Terminal handle from orca_terminal_start (omit for active terminal)" })),
      cursor: Type.Optional(Type.Number({ description: "Line cursor from a previous read; returns only new output" })),
      limit: Type.Optional(Type.Number({ description: "Max rows to return" })),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return { content: [{ type: "text", text: "Not in an Orca session." }], details: {} };
      const args = ["terminal", "read"];
      if (params.handle) args.push("--terminal", params.handle);
      if (typeof params.cursor === "number") args.push("--cursor", String(params.cursor));
      if (typeof params.limit === "number") args.push("--limit", String(params.limit));
      const r = runOrca<any>(args);
      if (!r.ok) return { content: [{ type: "text", text: `Read failed: ${r.error}` }], details: {} };
      const rows = r.result?.rows ?? r.result?.lines ?? r.result?.output ?? "";
      const text = Array.isArray(rows) ? rows.join("\n") : String(rows);
      return {
        content: [{ type: "text", text: text || "(no output)" }],
        details: { nextCursor: r.result?.nextCursor, oldestCursor: r.result?.oldestCursor },
      };
    },
  });

  pi.registerTool({
    name: "orca_terminal_wait",
    label: "Orca Terminal Wait",
    description:
      "Wait for an Orca terminal condition: 'exit' (command finished) or 'tui-idle' (interactive process stopped producing output, e.g. dev server ready). Returns when the condition is met or the timeout elapses.",
    promptSnippet: "Wait for an Orca terminal to finish or go idle",
    parameters: Type.Object({
      handle: Type.Optional(Type.String({ description: "Terminal handle (omit for active terminal)" })),
      for: Type.Union([Type.Literal("exit"), Type.Literal("tui-idle")], { description: "Condition to wait for" }),
      timeoutMs: Type.Optional(Type.Number({ description: "Max wait in ms (default 60000)" })),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return { content: [{ type: "text", text: "Not in an Orca session." }], details: {} };
      const timeout = params.timeoutMs ?? 60000;
      const args = ["terminal", "wait", "--for", params.for, "--timeout-ms", String(timeout)];
      if (params.handle) args.push("--terminal", params.handle);
      const r = runOrca<any>(args, timeout + 5000);
      if (!r.ok) return { content: [{ type: "text", text: `Wait failed or timed out: ${r.error}` }], details: r.result || {} };
      return { content: [{ type: "text", text: `Condition '${params.for}' met.` }], details: r.result || {} };
    },
  });

  pi.registerTool({
    name: "orca_terminal_send",
    label: "Orca Terminal Send",
    description: "Send input (text and/or Enter) to a live Orca terminal. Use to answer prompts or drive a REPL/TUI running in a terminal.",
    promptSnippet: "Send input to an Orca terminal",
    parameters: Type.Object({
      handle: Type.Optional(Type.String({ description: "Terminal handle (omit for active terminal)" })),
      text: Type.Optional(Type.String({ description: "Text to send" })),
      enter: Type.Optional(Type.Boolean({ description: "Append Enter after the text (default true when text is present)" })),
      interrupt: Type.Optional(Type.Boolean({ description: "Send an interrupt (Ctrl-C style) instead of text" })),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return { content: [{ type: "text", text: "Not in an Orca session." }], details: {} };
      const args = ["terminal", "send"];
      if (params.handle) args.push("--terminal", params.handle);
      if (params.interrupt) {
        args.push("--interrupt");
      } else {
        if (params.text) args.push("--text", params.text);
        if (params.enter !== false) args.push("--enter");
      }
      const r = runOrca(args);
      if (!r.ok) return { content: [{ type: "text", text: `Send failed: ${r.error}` }], details: {} };
      return { content: [{ type: "text", text: "Sent." }], details: {} };
    },
  });

  pi.registerTool({
    name: "orca_terminal_list",
    label: "Orca Terminal List",
    description: "List live Orca-managed terminals for a worktree (default: active).",
    promptSnippet: "List Orca terminals",
    parameters: Type.Object({
      worktree: Type.Optional(Type.String({ description: "Worktree selector (default: active)" })),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return { content: [{ type: "text", text: "Not in an Orca session." }], details: {} };
      const r = runOrca<any>(["terminal", "list", "--worktree", params.worktree || "active"]);
      if (!r.ok) return { content: [{ type: "text", text: `List failed: ${r.error}` }], details: {} };
      const terms = r.result?.terminals || [];
      if (terms.length === 0) return { content: [{ type: "text", text: "No live terminals." }], details: { terminals: [] } };
      const lines = terms.map((t: any) => `${t.handle || t.id} \u2014 ${t.title || "(untitled)"}${t.command ? ` [${t.command}]` : ""}`);
      return { content: [{ type: "text", text: lines.join("\n") }], details: { terminals: terms } };
    },
  });

  pi.registerTool({
    name: "orca_terminal_stop",
    label: "Orca Terminal Stop",
    description: "Stop all Orca terminals for a worktree (default: active). Use to tear down dev servers/watchers started with orca_terminal_start.",
    promptSnippet: "Stop Orca terminals for a worktree",
    parameters: Type.Object({
      worktree: Type.Optional(Type.String({ description: "Worktree selector (default: active)" })),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return { content: [{ type: "text", text: "Not in an Orca session." }], details: {} };
      const r = runOrca(["terminal", "stop", "--worktree", params.worktree || "active"]);
      if (!r.ok) return { content: [{ type: "text", text: `Stop failed: ${r.error}` }], details: {} };
      return { content: [{ type: "text", text: "Stopped terminals." }], details: {} };
    },
  });
}
