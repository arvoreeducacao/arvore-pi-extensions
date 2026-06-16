import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { complete } from "@earendil-works/pi-ai";

type Complexity = "trivial" | "simple" | "medium" | "complex";

const CLASSIFICATION_PROMPT = `You are a task complexity classifier for a coding agent. Based on the recent conversation context and the user's latest message, classify the TASK complexity (not the message complexity).

Rules:
- If the user says "ok", "bora", "yes", "continue", "go ahead" etc., look at what they're agreeing TO — the previous assistant message defines the task.
- "trivial": Simple acknowledgments with no pending task, greetings, or meta-conversation
- "simple": Single-file fixes, typos, small changes, quick questions
- "medium": Multi-file changes, feature implementation, debugging
- "complex": Architecture design, large refactors, security audits, system-wide changes, performance optimization across multiple services

Respond with ONLY one word: trivial, simple, medium, or complex`;

export function createRouter(pi: ExtensionAPI) {
  let lastClassification: Complexity | null = null;

  return {
    async pick(prompt: string, ctx: any): Promise<string | null> {
      const usage = ctx.getContextUsage?.();
      if (usage && usage.tokens > 500_000) {
        return "claude-sonnet-4-6";
      }

      const model = ctx.modelRegistry.find("kiro", "claude-haiku-4-5");
      if (!model) return null;

      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok || !auth.apiKey) return null;

      const recentContext = buildRecentContext(ctx);

      const messages = [
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: `${recentContext}\n\nLatest user message: "${prompt}"\n\nClassify the TASK complexity:`,
            },
          ],
          timestamp: Date.now(),
        },
      ];

      try {
        const response = await complete(
          model,
          { messages, systemPrompt: CLASSIFICATION_PROMPT },
          { apiKey: auth.apiKey, headers: auth.headers, maxTokens: 10 }
        );

        const answer = response.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text.trim().toLowerCase())
          .join("");

        const complexity = parseComplexity(answer);
        lastClassification = complexity;
        return modelForComplexity(complexity);
      } catch {
        return null;
      }
    },
  };
}

function buildRecentContext(ctx: any): string {
  const entries = ctx.sessionManager?.getEntries?.();
  if (!entries || entries.length === 0) return "No previous context.";

  const recent = entries.slice(-6);
  const lines: string[] = [];

  for (const entry of recent) {
    if (entry.type === "message") {
      const role = entry.message?.role;
      const text = extractEntryText(entry);
      if (role && text) {
        lines.push(`[${role}]: ${text.slice(0, 200)}`);
      }
    }
  }

  return lines.length > 0
    ? `Recent conversation:\n${lines.join("\n")}`
    : "No previous context.";
}

function extractEntryText(entry: any): string {
  const msg = entry.message;
  if (!msg) return "";
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join(" ");
  }
  return "";
}

function parseComplexity(answer: string): Complexity {
  if (answer.includes("trivial")) return "trivial";
  if (answer.includes("complex")) return "complex";
  if (answer.includes("simple")) return "simple";
  if (answer.includes("medium")) return "medium";
  return "medium";
}

function modelForComplexity(complexity: Complexity): string | null {
  switch (complexity) {
    case "trivial":
      return "claude-haiku-4-5";
    case "simple":
      return "claude-sonnet-4-5";
    case "complex":
      return "claude-opus-4-6";
    case "medium":
    default:
      return null;
  }
}
