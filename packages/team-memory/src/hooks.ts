import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { MemoryCategory } from "./types.js";
import { VALID_CATEGORIES } from "./types.js";
import { MemoryStore } from "./store.js";

const DECISION_PATTERNS = [
  /we (?:should|will|decided to|agreed to) use/i,
  /the (?:approach|strategy|solution) (?:is|will be)/i,
  /(?:architecture|design) (?:decision|choice)/i,
  /we (?:went with|chose|selected)/i,
  /(?:best practice|standard) (?:is|for)/i,
];

const GOTCHA_PATTERNS = [
  /(?:gotcha|caveat|warning|note):/i,
  /make sure (?:to|you)/i,
  /don't forget to/i,
  /be careful (?:with|about)/i,
  /watch out for/i,
  /this (?:breaks|fails|doesn't work)/i,
  /the issue (?:was|is)/i,
  /root cause (?:was|is)/i,
];

const CONVENTION_PATTERNS = [
  /we (?:always|never|typically) /i,
  /our (?:convention|standard|pattern) (?:is|for)/i,
  /by convention,/i,
  /we follow (?:the|a)/i,
];

function detectMemoryCategory(text: string): MemoryCategory | null {
  const lowerText = text.toLowerCase();

  for (const pattern of DECISION_PATTERNS) {
    if (pattern.test(text)) return "decisions";
  }

  for (const pattern of GOTCHA_PATTERNS) {
    if (pattern.test(text)) return "gotchas";
  }

  for (const pattern of CONVENTION_PATTERNS) {
    if (pattern.test(text)) return "conventions";
  }

  if (
    lowerText.includes("incident") ||
    lowerText.includes("outage") ||
    lowerText.includes("bug") ||
    lowerText.includes("production")
  ) {
    return "incidents";
  }

  return null;
}

function extractLastAssistantText(entries: any[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "message" && entry.message?.role === "assistant") {
      const content = entry.message.content;
      if (Array.isArray(content)) {
        return content
          .filter((c: any): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("\n");
      }
    }
  }
  return "";
}

function extractUserPrompt(entries: any[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "message" && entry.message?.role === "user") {
      const content = entry.message.content;
      if (Array.isArray(content)) {
        const textPart = content.find((c: any) => c.type === "text");
        if (textPart) return textPart.text;
      }
      if (typeof content === "string") return content;
    }
  }
  return "";
}

export function registerMemoryHooks(pi: ExtensionAPI, store: MemoryStore) {
  pi.on("session_shutdown", async (_event, ctx: ExtensionContext) => {
    const entries = ctx.sessionManager.getEntries();
    const assistantText = extractLastAssistantText(entries);
    const userPrompt = extractUserPrompt(entries);

    if (!assistantText && !userPrompt) return;

    const category = detectMemoryCategory(assistantText + " " + userPrompt);

    if (!category) {
      return;
    }

    if (!ctx.hasUI) return;

    const capture = await ctx.ui.confirm(
      "Capture team memory?",
      `This session may contain a ${category} worth saving. Add to team memory?`
    );

    if (!capture) return;

    const title = await ctx.ui.input("Memory title:", "");

    if (!title || title.trim().length === 0) {
      ctx.ui.notify("Cancelled — title is required", "warning");
      return;
    }

    const content = await ctx.ui.editor(
      "Memory content (markdown):",
      assistantText.slice(0, 2000)
    );

    if (!content || content.trim().length === 0) {
      ctx.ui.notify("Cancelled — content is required", "warning");
      return;
    }

    const entry = await store.add({
      title: title.trim(),
      category,
      content: content.trim(),
    });

    ctx.ui.notify(`Created memory: ${entry.id}`, "info");
  });

  pi.on("agent_end", async (event, ctx: ExtensionContext) => {
    const messages = event.messages;
    if (!messages || messages.length === 0) return;

    const lastAssistant = messages.find(
      (m: any) => m.role === "assistant" && "content" in m && m.content
    );

    if (!lastAssistant) return;

    const content = Array.isArray((lastAssistant as any).content)
      ? (lastAssistant as any).content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n")
      : "";

    const category = detectMemoryCategory(content);

    if (!category) return;

    const shouldSuggest = await shouldSuggestCapture(content);

    if (!shouldSuggest) return;

    if (!ctx.hasUI) return;

    const prompt = await ctx.ui.input(
      "Add memory title (or leave empty to skip):",
      ""
    );

    if (!prompt || prompt.trim().length === 0) return;

    const memoryContent = await ctx.ui.editor(
      "Memory content:",
      content.slice(0, 2000)
    );

    if (!memoryContent || memoryContent.trim().length === 0) return;

    const entry = await store.add({
      title: prompt.trim(),
      category,
      content: memoryContent.trim(),
    });

    ctx.ui.notify(`Saved: ${entry.id}`, "info");
  });
}

async function shouldSuggestCapture(text: string): Promise<boolean> {
  const significantIndicators = [
    "we decided",
    "the solution is",
    "root cause",
    "the issue was",
    "best practice",
    "we should",
    "convention:",
    "gotcha:",
  ];

  const lowerText = text.toLowerCase();
  return significantIndicators.some((indicator) => lowerText.includes(indicator));
}
