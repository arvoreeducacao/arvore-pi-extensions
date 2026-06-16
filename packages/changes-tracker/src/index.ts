import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

class DiffViewer implements Component {
  private lines: string[];
  private scrollOffset = 0;
  private tui: TUI;
  private theme: any;
  private done: () => void;

  constructor(tui: TUI, theme: any, lines: string[], done: () => void) {
    this.tui = tui;
    this.theme = theme;
    this.lines = lines;
    this.done = done;
  }

  private getMax() {
    return Math.max(1, (this.tui.terminal?.rows || 30) - 3);
  }

  render(width: number): string[] {
    const max = this.getMax();
    const visible = this.lines.slice(this.scrollOffset, this.scrollOffset + max);
    const theme = this.theme;
    const output: string[] = [];

    for (const line of visible) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        output.push(theme.fg("success", line));
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        output.push(theme.fg("error", line));
      } else if (line.startsWith("@@")) {
        output.push(theme.fg("accent", line));
      } else if (line.startsWith("diff ")) {
        output.push(theme.bold(theme.fg("warning", line)));
      } else {
        output.push(theme.fg("dim", line));
      }
    }

    const to = Math.min(this.scrollOffset + max, this.lines.length);
    output.push(theme.fg("muted", `\u2500 ${this.scrollOffset + 1}-${to}/${this.lines.length} \u2500 jk/\u2191\u2193 scroll \u00b7 space/b page \u00b7 q close`));
    return output;
  }

  handleInput(key: string) {
    const max = this.getMax();
    const maxScroll = Math.max(0, this.lines.length - max);
    if (key === "q" || key === "\x1b") { this.done(); }
    else if (key === "\x1b[B" || key === "j") { this.scrollOffset = Math.min(this.scrollOffset + 1, maxScroll); this.tui.requestRender(); }
    else if (key === "\x1b[A" || key === "k") { this.scrollOffset = Math.max(0, this.scrollOffset - 1); this.tui.requestRender(); }
    else if (key === " " || key === "\x1b[6~") { this.scrollOffset = Math.min(this.scrollOffset + max, maxScroll); this.tui.requestRender(); }
    else if (key === "b" || key === "\x1b[5~") { this.scrollOffset = Math.max(0, this.scrollOffset - max); this.tui.requestRender(); }
  }

  invalidate() {}
}

export default function (pi: ExtensionAPI) {
  let repoDirs: string[] = ["."];

  pi.on("session_start", async () => {
    const { stdout } = await pi.exec("find", [".", "-maxdepth", "2", "-name", ".git", "-type", "d"]);
    repoDirs = stdout.trim().split("\n").filter(Boolean).map((p) => p.replace(/\/\.git$/, ""));
    if (repoDirs.length === 0) repoDirs = ["."];
  });

  pi.registerCommand("changed", {
    description: "Show repos and files with uncommitted changes",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;

      const theme = ctx.ui.theme;
      const lines: string[] = [];

      for (const dir of repoDirs) {
        const { stdout } = await pi.exec("git", ["-C", dir, "diff", "--numstat", "HEAD"]);
        const { stdout: untrackedOut } = await pi.exec("git", ["-C", dir, "ls-files", "--others", "--exclude-standard"]);
        const statLines = stdout.trim().split("\n").filter(Boolean);
        const untracked = untrackedOut.trim().split("\n").filter(Boolean);
        if (statLines.length === 0 && untracked.length === 0) continue;

        const repoName = dir === "." ? "." : dir.replace("./", "");
        const total = statLines.length + untracked.length;
        lines.push(theme.bold(theme.fg("accent", `${repoName}/`)) + theme.fg("dim", ` (${total})`));

        for (const sl of statLines.slice(0, 10)) {
          const parts = sl.split("\t");
          const added = parts[0] || "0";
          const removed = parts[1] || "0";
          const file = parts[2] || "";
          const plus = Number(added) > 0 ? theme.fg("success", `+${added}`) : "";
          const minus = Number(removed) > 0 ? theme.fg("error", `-${removed}`) : "";
          lines.push(`  ${theme.fg("dim", file)} ${plus} ${minus}`);
        }
        for (const f of untracked.slice(0, Math.max(0, 10 - statLines.length))) {
          lines.push(`  ${theme.fg("dim", f)} ${theme.fg("warning", "new")}`);
        }
        if (total > 10) {
          lines.push(theme.fg("muted", `  ... +${total - 10} more`));
        }
      }

      if (lines.length === 0) {
        ctx.ui.notify("No changes", "info");
        return;
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("changes", {
    description: "Show full diff of current changes",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;

      const results: string[] = [];
      for (const dir of repoDirs) {
        const { stdout } = await pi.exec("git", ["-C", dir, "diff", "HEAD"]);
        if (stdout.trim()) {
          const prefix = dir === "." ? "" : dir.replace("./", "") + "/";
          results.push(
            stdout
              .replace(/^diff --git a\//gm, `diff --git a/${prefix}`)
              .replace(/^(\+\+\+|---) ([ab])\//gm, `$1 $2/${prefix}`)
          );
        }
      }
      const diff = results.join("\n");

      if (!diff.trim()) {
        ctx.ui.notify("No changes", "info");
        return;
      }

      await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
        const diffLines = diff.split("\n").filter((l) => l !== "");
        return new DiffViewer(tui, theme, diffLines, done);
      });
    },
  });
}
