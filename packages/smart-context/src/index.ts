import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createRouter } from "./router.js";
import { createCompressor } from "./compression/pipeline.js";
import { createContentStore } from "./compression/store.js";
import { createSummarizer } from "./compression/haiku-summarize.js";
import { getDiagnostics } from "./host-ai.js";

export default function (pi: ExtensionAPI) {
  const router = createRouter(pi);
  const store = createContentStore();
  const summarizer = createSummarizer();
  const compressor = createCompressor({ store, summarizer });
  const debug = process.env.SMART_CONTEXT_DEBUG === "1";

  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const model = await router.pick(event.prompt, ctx);
      if (!model) {
        if (debug) ctx.ui.notify("smart-context: no route (keeping current model)", "info");
        return;
      }
      const resolved = ctx.modelRegistry.find("kiro", model);
      if (!resolved) {
        if (debug) ctx.ui.notify(`smart-context: model ${model} not found`, "warning");
        return;
      }
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(resolved);
      if (!auth.ok || !auth.apiKey) {
        if (debug) ctx.ui.notify(`smart-context: no auth for ${model}`, "warning");
        return;
      }
      await pi.setModel(resolved);
      if (debug) ctx.ui.notify(`smart-context: routed → ${model}`, "info");
    } catch (err) {
      if (debug) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`smart-context routing error: ${msg} [${getDiagnostics()}]`, "warning");
      }
    }
  });

  pi.on("context", async (event, ctx) => {
    const messages = await compressor.compress(event.messages as any[], ctx);
    return { messages } as any;
  });

  pi.on("tool_result", async (event) => {
    if (event.toolName !== "bash" && event.toolName !== "read" && event.toolName !== "grep") {
      return;
    }
    const compressed = compressor.compressToolResult(event.toolName, event.content as any[]);
    if (compressed) {
      return { content: compressed } as any;
    }
  });

  pi.registerTool({
    name: "recover_context",
    label: "Recover Context",
    description:
      "Recover the full original content of a message that was compressed/summarized in the conversation context. Pass the id shown in a recover_context(\"id\") hint.",
    promptSnippet:
      "Recover full original text of a compressed message by its id",
    promptGuidelines: [
      'Use recover_context when a compressed or summarized message lacks detail you need and shows a recover_context("id") hint.',
    ],
    parameters: Type.Object({
      id: Type.String({ description: "The content id from a recover_context(\"id\") hint" }),
    }),
    async execute(_toolCallId, params): Promise<{
      content: { type: "text"; text: string }[];
      details: Record<string, unknown>;
    }> {
      const stored = store.get(params.id);
      if (!stored) {
        return {
          content: [{ type: "text", text: `No stored content for id "${params.id}".` }],
          details: {},
        };
      }
      return {
        content: [{ type: "text", text: stored.original }],
        details: { id: stored.id, chars: stored.chars, role: stored.role },
      };
    },
  });

  pi.registerCommand("smart-context", {
    description: "Show smart-context compression stats",
    handler: async (_args, ctx) => {
      const s = compressor.getStats();
      ctx.ui.notify(
        `Saved ${s.totalSaved} chars (${s.ratio}% avg) | turns ${s.turnsProcessed} | ` +
          `haiku ${s.haikuCalls} calls / ${s.haikuCacheHits} cached | recoverable ${s.storedItems}`,
        "info"
      );
    },
  });
}
