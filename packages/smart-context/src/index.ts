import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRouter } from "./router.js";
import { createCompressor } from "./compression/pipeline.js";

export default function (pi: ExtensionAPI) {
  const router = createRouter(pi);
  const compressor = createCompressor();

  pi.on("before_agent_start", async (event, ctx) => {
    const model = await router.pick(event.prompt, ctx);
    if (model) {
      const resolved = ctx.modelRegistry.find("kiro", model);
      if (resolved) {
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(resolved);
        if (auth.ok && auth.apiKey) {
          await pi.setModel(resolved);
        }
      }
    }
  });

  pi.on("context", async (event) => {
    const messages = compressor.compress(event.messages as any[]);
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

  pi.registerCommand("smart-context", {
    description: "Show smart-context stats",
    handler: async (_args, ctx) => {
      const stats = compressor.getStats();
      ctx.ui.notify(
        `Compression: ${stats.totalSaved} chars saved (${stats.ratio}% avg reduction) | Turns: ${stats.turnsProcessed}`,
        "info"
      );
    },
  });
}
