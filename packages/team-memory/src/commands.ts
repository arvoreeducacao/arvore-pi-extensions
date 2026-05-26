import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { MemoryCategory } from "./types.js";
import { VALID_CATEGORIES } from "./types.js";
import { MemoryStore } from "./store.js";
import { getPendingCandidates, clearCandidate } from "./hooks.js";

class MemoryListComponent {
  private memories: { id: string; title: string; category: string; snippet: string }[];
  private theme: any;
  private onClose: () => void;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(
    memories: { id: string; title: string; category: string; snippet: string }[],
    theme: any,
    onClose: () => void
  ) {
    this.memories = memories;
    this.theme = theme;
    this.onClose = onClose;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onClose();
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    const th = this.theme;

    lines.push("");
    const title = th.fg("accent", " Team Memories ");
    const headerLine =
      th.fg("borderMuted", "─".repeat(3)) +
      title +
      th.fg("borderMuted", "─".repeat(Math.max(0, width - 20)));
    lines.push(truncateToWidth(headerLine, width));
    lines.push("");

    if (this.memories.length === 0) {
      lines.push(
        truncateToWidth(`  ${th.fg("dim", "No memories yet. Add one with /memory add")}`, width)
      );
    } else {
      lines.push(
        truncateToWidth(`  ${th.fg("muted", `${this.memories.length} memories`)}`, width)
      );
      lines.push("");

      for (const m of this.memories.slice(0, 20)) {
        const cat = th.fg("accent", `[${m.category}]`);
        const title = th.fg("text", m.title);
        const id = th.fg("dim", `(${m.id})`);
        lines.push(truncateToWidth(`  ${cat} ${title} ${id}`, width));
      }

      if (this.memories.length > 20) {
        lines.push(
          truncateToWidth(`  ${th.fg("dim", `... ${this.memories.length - 20} more`)}`, width)
        );
      }
    }

    lines.push("");
    lines.push(truncateToWidth(`  ${th.fg("dim", "Press Escape to close")}`, width));
    lines.push("");

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

export function registerMemoryCommands(pi: ExtensionAPI, store: MemoryStore) {
  pi.registerCommand("memories", {
    description: "Browse all team memories",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/memories requires interactive mode", "error");
        return;
      }

      const memories = store.getCatalog().map((m) => ({
        id: m.id,
        title: m.title,
        category: m.category,
        snippet: m.content.slice(0, 100),
      }));

      await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
        return new MemoryListComponent(memories, theme, () => done());
      });
    },
  });

  pi.registerCommand("memory", {
    description: "Manage memories: /memory add <category> <title>",
    getArgumentCompletions: (prefix: string) => {
      const parts = prefix.split(" ");
      if (parts.length === 1) {
        const actions = ["add", "list", "search", "get", "archive"];
        return actions
          .filter((a) => a.startsWith(prefix))
          .map((a) => ({ value: a, label: a }));
      }
      if (parts.length === 2 && parts[0] === "add") {
        return VALID_CATEGORIES.filter((c) => c.startsWith(parts[1])).map((c) => ({
          value: `${parts[0]} ${c}`,
          label: c,
        }));
      }
      return null;
    },
    handler: async (args, ctx: ExtensionCommandContext) => {
      const parts = args.trim().split(/\s+/);
      const action = parts[0];

      if (action === "add") {
        const category = parts[1] as MemoryCategory;
        const title = parts.slice(2).join(" ");

        if (!category || !VALID_CATEGORIES.includes(category)) {
          ctx.ui.notify(
            `Usage: /memory add <category> <title>\nCategories: ${VALID_CATEGORIES.join(", ")}`,
            "warning"
          );
          return;
        }

        if (!title) {
          ctx.ui.notify("Usage: /memory add <category> <title>", "warning");
          return;
        }

        const content = await ctx.ui.editor("Enter memory content (markdown):", "");

        if (!content || content.trim().length === 0) {
          ctx.ui.notify("Memory content is required", "warning");
          return;
        }

        const entry = await store.add({
          title,
          category,
          content: content.trim(),
        });

        ctx.ui.notify(`Created memory: ${entry.id}`, "info");
        return;
      }

      if (action === "list") {
        const category = parts[1] as MemoryCategory | undefined;
        const results = await store.list({ category } as any);

        if (results.length === 0) {
          ctx.ui.notify("No memories found", "info");
          return;
        }

        const lines = results.map((r) => `[${r.category}] ${r.title} (${r.id})`);
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      if (action === "search") {
        const query = parts.slice(1).join(" ");

        if (!query) {
          ctx.ui.notify("Usage: /memory search <query>", "warning");
          return;
        }

        const results = await store.search(query);

        if (results.length === 0) {
          ctx.ui.notify("No memories found", "info");
          return;
        }

        const lines = results.map((r) => `[${r.category}] ${r.title} (${r.id}) - ${r.score}`);
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      if (action === "get") {
        const id = parts[1];

        if (!id) {
          ctx.ui.notify("Usage: /memory get <id>", "warning");
          return;
        }

        const entry = await store.get(id);

        if (!entry) {
          ctx.ui.notify(`Memory "${id}" not found`, "warning");
          return;
        }

        await ctx.ui.editor("Memory content:", entry.content);
        return;
      }

      if (action === "archive") {
        const id = parts[1];

        if (!id) {
          ctx.ui.notify("Usage: /memory archive <id>", "warning");
          return;
        }

        const confirmed = await ctx.ui.confirm("Archive memory?", `Archive ${id}?`);

        if (!confirmed) {
          ctx.ui.notify("Cancelled", "info");
          return;
        }

        const entry = await store.archive(id);
        ctx.ui.notify(`Archived: ${entry.title}`, "info");
        return;
      }

      ctx.ui.notify(
        `Usage: /memory <action> [args]\nActions: add, list, search, get, archive`,
        "warning"
      );
    },
  });

  pi.registerCommand("capture", {
    description: "Capture a memory from recent conversation candidates",
    getArgumentCompletions: (prefix: string) => {
      if (prefix === "") {
        return [
          { value: "list", label: "list" },
          { value: "clear", label: "clear" },
        ];
      }
      return null;
    },
    handler: async (args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/capture requires interactive mode", "error");
        return;
      }

      const candidates = getPendingCandidates();

      if (args === "list") {
        if (candidates.length === 0) {
          ctx.ui.notify("No pending memory candidates", "info");
          return;
        }
        const lines = candidates.map(
          (c, i) => `${i + 1}. [${c.category}] ${c.title}`
        );
        ctx.ui.notify(`Pending candidates:\n${lines.join("\n")}`, "info");
        return;
      }

      if (args === "clear") {
        const count = candidates.length;
        candidates.length = 0;
        ctx.ui.setWidget("memory-capture", []);
        ctx.ui.notify(`Cleared ${count} pending candidates`, "info");
        return;
      }

      if (args?.startsWith("clear ")) {
        const index = parseInt(args.slice(6), 10) - 1;
        if (isNaN(index) || index < 0 || index >= candidates.length) {
          ctx.ui.notify(
            `Invalid index. Use /capture clear <1-${candidates.length}>`,
            "warning"
          );
          return;
        }
        clearCandidate(index);
        if (candidates.length === 0) {
          ctx.ui.setWidget("memory-capture", []);
        }
        ctx.ui.notify("Cleared candidate", "info");
        return;
      }

      if (candidates.length === 0) {
        const title = await ctx.ui.input("Memory title:", "");
        if (!title || title.trim().length === 0) {
          ctx.ui.notify("Title is required", "warning");
          return;
        }

        const category = await ctx.ui.select("Select category:", [...VALID_CATEGORIES]);

        if (!category) {
          ctx.ui.notify("Cancelled", "info");
          return;
        }

        const content = await ctx.ui.editor("Memory content (markdown):", "");
        if (!content || content.trim().length === 0) {
          ctx.ui.notify("Content is required", "warning");
          return;
        }

        const entry = await store.add({
          title: title.trim(),
          category: category as MemoryCategory,
          content: content.trim(),
        });

        ctx.ui.notify(`Created memory: ${entry.id}`, "info");
        return;
      }

      const options = [
        ...candidates.map((c, i) => `${i + 1}. [${c.category}] ${c.title}`),
        "Create new memory...",
      ];
      const choice = await ctx.ui.select("Select memory to capture:", options);

      if (!choice) {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      if (choice === "Create new memory...") {
        const title = await ctx.ui.input("Memory title:", "");
        if (!title || title.trim().length === 0) {
          ctx.ui.notify("Title is required", "warning");
          return;
        }

        const category = await ctx.ui.select("Select category:", [...VALID_CATEGORIES]);

        if (!category) {
          ctx.ui.notify("Cancelled", "info");
          return;
        }

        const content = await ctx.ui.editor("Memory content (markdown):", "");
        if (!content || content.trim().length === 0) {
          ctx.ui.notify("Content is required", "warning");
          return;
        }

        const entry = await store.add({
          title: title.trim(),
          category: category as MemoryCategory,
          content: content.trim(),
        });

        ctx.ui.notify(`Created memory: ${entry.id}`, "info");
        return;
      }

      const match = choice.match(/^(\d+)\./);
      if (!match) {
        ctx.ui.notify("Invalid selection", "warning");
        return;
      }
      const index = parseInt(match[1], 10) - 1;
      const candidate = candidates[index];

      const editedTitle = await ctx.ui.input("Memory title:", candidate.title);
      if (!editedTitle || editedTitle.trim().length === 0) {
        ctx.ui.notify("Title is required", "warning");
        return;
      }

      const categoryIndex = VALID_CATEGORIES.indexOf(candidate.category);
      const category = await ctx.ui.select("Select category:", [...VALID_CATEGORIES]);

      if (!category) {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      const editedContent = await ctx.ui.editor(
        "Memory content (markdown):",
        candidate.content
      );

      if (!editedContent || editedContent.trim().length === 0) {
        ctx.ui.notify("Content is required", "warning");
        return;
      }

      const entry = await store.add({
        title: editedTitle.trim(),
        category: category as MemoryCategory,
        content: editedContent.trim(),
      });

      clearCandidate(index);

      if (candidates.length === 0) {
        ctx.ui.setWidget("memory-capture", []);
      }

      ctx.ui.notify(`Created memory: ${entry.id}`, "info");
    },
  });
}
