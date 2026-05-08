import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { MemoryStore } from "./store.js";
import { registerMemoryCommands } from "./commands.js";
import { registerMemoryTools } from "./tools.js";
import { registerMemoryHooks } from "./hooks.js";
import { join } from "node:path";

export default function teamMemoryExtension(pi: ExtensionAPI) {
  const memoriesPath = join(process.cwd(), ".pi", "memories");

  const store = new MemoryStore(memoriesPath);

  registerMemoryCommands(pi, store);
  registerMemoryTools(pi, store);
  registerMemoryHooks(pi, store);

  pi.on("session_start", async (_event, ctx) => {
    try {
      await store.load();
      const count = store.getCatalog().length;
      if (count > 0 && ctx.hasUI) {
        ctx.ui.setStatus("team-memory", `${count} memories`);
      }
    } catch (error) {
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Team memory load failed: ${error instanceof Error ? error.message : error}`,
          "warning"
        );
      }
    }
  });

  pi.on("session_shutdown", async () => {
    const count = store.getCatalog().filter((m) => m.status === "active").length;
    console.error(`Team memory: ${count} active memories`);
  });
}

export { MemoryStore } from "./store.js";
export type { MemoryEntry, MemoryCatalogEntry, MemoryCategory, MemoryStatus } from "./types.js";
