import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getComplete } from "./host-ai.js";
import { loadConfig, configFilePath, type Complexity, type ModelRef } from "./config.js";

const CLASSIFICATION_PROMPT = `You are a task complexity classifier for a coding agent. Based on the recent conversation context and the user's latest message, classify the TASK complexity (not the message complexity).

Rules:
- If the user says "ok", "bora", "yes", "continue", "go ahead" etc., look at what they're agreeing TO — the previous assistant message defines the task.
- "trivial": Simple acknowledgments with no pending task, greetings, or meta-conversation
- "simple": Single-file fixes, typos, small changes, quick questions with a clear answer
- "medium": Multi-file changes, feature implementation, debugging, code review, most coding tasks
- "complex": Architecture design, large refactors, security audits, system-wide changes, performance optimization across multiple services — ONLY use this for the most demanding tasks

When in doubt between simple and medium, choose medium. When in doubt between medium and complex, choose medium.

Respond with ONLY one word: trivial, simple, medium, or complex`;

export function createRouter(pi: ExtensionAPI) {
  return {
    async pick(prompt: string, ctx: any): Promise<ModelRef | null> {
      const config = loadConfig(ctx.cwd);
      const debug = process.env.SMART_CONTEXT_DEBUG === "1";
      const log = (msg: string) => {
        if (debug) ctx.ui?.notify?.(`smart-context[pick] ${msg}`, "info");
      };

      const usage = ctx.getContextUsage?.();
      if (debug) {
        log(
          `cwd=${ctx.cwd} cfg=${configFilePath(ctx.cwd) ?? "<none>"} ` +
            `tokens=${usage?.tokens ?? "n/a"} threshold=${config.largeContext.thresholdTokens} ` +
            `classifier=${config.classifier.provider}/${config.classifier.model}`,
        );
      }

      if (usage && usage.tokens > config.largeContext.thresholdTokens) {
        log(`branch=largeContext → ${config.largeContext.model.provider}/${config.largeContext.model.model}`);
        return config.largeContext.model;
      }

      const { classifier } = config;
      const model = ctx.modelRegistry.find(classifier.provider, classifier.model);
      if (!model) {
        log(`branch=classifier-find-null (${classifier.provider}/${classifier.model})`);
        return null;
      }

      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok || !auth.apiKey) {
        log(`branch=classifier-auth-fail ok=${auth.ok}`);
        return null;
      }

      const complete = await getComplete();
      if (!complete) throw new Error("could not resolve host pi-ai complete()");
      log("branch=classifier-running");

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

      const response = await complete(
        model,
        { messages, systemPrompt: CLASSIFICATION_PROMPT },
        { apiKey: auth.apiKey, headers: auth.headers, maxTokens: 10 }
      );

      const answer = response.content
        .filter((c: { type: string; text?: string }): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
        .map((c: { text: string }) => c.text.trim().toLowerCase())
        .join("");

      const complexity = parseComplexity(answer);
      const chosen = config.routing[complexity];
      log(`branch=classifier-done complexity=${complexity} → ${chosen.provider}/${chosen.model}`);
      return chosen;
    },
  };
}

const CONTEXT_CHAR_BUDGET = 6000;
const PER_MESSAGE_CHAR_CAP = 300;

function buildRecentContext(ctx: any): string {
  const entries = ctx.sessionManager?.getEntries?.();
  if (!entries || entries.length === 0) return "No previous context.";

  const lines: string[] = [];
  let budget = CONTEXT_CHAR_BUDGET;

  for (let i = entries.length - 1; i >= 0 && budget > 0; i--) {
    const entry = entries[i];
    if (entry.type !== "message") continue;
    const role = entry.message?.role;
    const text = extractEntryText(entry);
    if (!role || !text) continue;
    const snippet = text.slice(0, PER_MESSAGE_CHAR_CAP);
    lines.unshift(`[${role}]: ${snippet}`);
    budget -= snippet.length;
  }

  return lines.length > 0
    ? `Conversation so far (most recent last):\n${lines.join("\n")}`
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
  const match = answer.trim().toLowerCase().match(/\b(trivial|simple|medium|complex)\b/);
  if (match) return match[1] as Complexity;
  return "medium";
}
