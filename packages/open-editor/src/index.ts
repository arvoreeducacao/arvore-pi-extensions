import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GUI_EDITORS = ["code", "cursor", "zed", "subl", "sublime_text", "atom", "webstorm", "idea"];

function isGuiEditor(editor: string): boolean {
  const base = editor.split("/").pop() || "";
  return GUI_EDITORS.some((g) => base.startsWith(g));
}

function buildEditorCommand(editor: string, filePath: string, line?: number): string {
  if (line) {
    if (editor.includes("vim") || editor.includes("nvim")) return `${editor} +${line} '${filePath}'`;
    if (editor.includes("nano")) return `${editor} +${line} '${filePath}'`;
    if (editor.includes("emacs")) return `${editor} +${line} '${filePath}'`;
    return `${editor} '${filePath}'`;
  }
  return `${editor} '${filePath}'`;
}

function detectTerminal(): string | null {
  const knownTerminals = ["kitty", "ghostty", "alacritty", "wezterm", "warp", "gnome-terminal", "xterm"];

  let pid: number | null = process.ppid;
  while (pid && pid > 1) {
    try {
      const comm = readFileSync(`/proc/${pid}/comm`, "utf-8").trim();
      const match = knownTerminals.find((t) => comm.includes(t));
      if (match) {
        const which = spawnSync("which", [match], { encoding: "utf-8" });
        return which.status === 0 ? which.stdout.trim() : match;
      }
      const stat: string = readFileSync(`/proc/${pid}/stat`, "utf-8");
      const ppidMatch: RegExpMatchArray | null = stat.match(/\) \S+ (\d+)/);
      pid = ppidMatch ? parseInt(ppidMatch[1], 10) : null;
    } catch {
      break;
    }
  }

  for (const t of knownTerminals) {
    try {
      const result = spawnSync("which", [t], { encoding: "utf-8" });
      if (result.status === 0) return result.stdout.trim();
    } catch {}
  }
  return null;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "open_in_editor",
    label: "Open in Editor",
    description:
      "Open a file in the user's $EDITOR. Use when the user wants to see or edit a file themselves, or when showing code changes they might want to interact with.",
    parameters: Type.Object({
      path: Type.String({ description: "File path to open" }),
      line: Type.Optional(Type.Number({ description: "Line number to jump to" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const editor = process.env.EDITOR || "nvim";
      const filePath = resolve(ctx.cwd, params.path);
      const inTmux = !!process.env.TMUX;

      if (inTmux) {
        const cmd = buildEditorCommand(editor, filePath, params.line);
        spawn("tmux", ["split-window", "-h", cmd], { stdio: "ignore" });
      } else if (isGuiEditor(editor)) {
        const args = params.line ? [`${filePath}:${params.line}`] : [filePath];
        spawn(editor, args, { detached: true, stdio: "ignore" }).unref();
      } else {
        const terminal = process.env.TERMINAL || detectTerminal();
        const cmd = buildEditorCommand(editor, filePath, params.line);
        if (terminal) {
          spawn(terminal, ["-e", "sh", "-c", cmd], { detached: true, stdio: "ignore", cwd: ctx.cwd }).unref();
        } else {
          return {
            content: [{ type: "text", text: `Could not open editor: no tmux, no GUI editor, and no terminal detected. File: ${filePath}` }],
            details: {},
          };
        }
      }

      const location = params.line ? `${params.path}:${params.line}` : params.path;
      return {
        content: [{ type: "text", text: `Opened ${location} in ${editor}${inTmux ? " (tmux pane)" : ""}` }],
        details: {},
      };
    },
  });
}
