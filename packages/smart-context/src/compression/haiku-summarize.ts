import { getComplete } from "../host-ai.js";
import { loadConfig } from "../config.js";
import { createHash } from "node:crypto";

const SUMMARIZE_PROMPT = `You compress conversation messages for an AI coding agent's context. Produce a dense summary that preserves ALL load-bearing facts: decisions made, file paths, function/variable names, API contracts, error messages, requirements, and open questions. Drop filler, pleasantries, and verbose explanations.

Output ONLY the compressed summary, no preamble. Be terse but lossless on facts.`;

export function createSummarizer() {
  const cache = new Map<string, string>();
  let calls = 0;
  let cacheHits = 0;

  async function summarize(text: string, ctx: any): Promise<string | null> {
    const key = createHash("sha256").update(text).digest("hex").slice(0, 16);
    const cached = cache.get(key);
    if (cached !== undefined) {
      cacheHits++;
      return cached;
    }

    const { classifier } = loadConfig(ctx.cwd);
    const model = ctx.modelRegistry?.find?.(classifier.provider, classifier.model);
    if (!model) return null;

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) return null;

    try {
      calls++;
      const complete = await getComplete();
      if (!complete) return null;
      const response = await complete(
        model,
        {
          messages: [
            {
              role: "user" as const,
              content: [{ type: "text" as const, text: `<message>\n${text}\n</message>` }],
              timestamp: Date.now(),
            },
          ],
          systemPrompt: SUMMARIZE_PROMPT,
        },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          maxTokens: Math.min(1024, Math.ceil(text.length / 8)),
          signal: ctx.signal,
        }
      );

      const summary = response.content
        .filter((c: { type: string; text?: string }): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
        .map((c: { text: string }) => c.text.trim())
        .join("\n");

      if (!summary) return null;

      cache.set(key, summary);
      return summary;
    } catch {
      return null;
    }
  }

  function getStats() {
    return { calls, cacheHits };
  }

  return { summarize, getStats };
}

export type Summarizer = ReturnType<typeof createSummarizer>;
