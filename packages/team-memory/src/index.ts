import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { MemoryStore } from "./store.js";
import { registerMemoryCommands } from "./commands.js";
import { registerMemoryTools } from "./tools.js";
import { registerMemoryHooks } from "./hooks.js";
import { join } from "node:path";

export default function teamMemoryExtension(pi: ExtensionAPI) {
  const memoriesPath = join(process.cwd(), "memories");

  const store = new MemoryStore(memoriesPath);

  registerMemoryCommands(pi, store);
  registerMemoryTools(pi, store);
  registerMemoryHooks(pi, store);

  pi.on("session_shutdown", async () => {
    const count = store.getCatalog().filter((m) => m.status === "active").length;
    console.error(`Team memory: ${count} active memories`);
  });
}

export { MemoryStore } from "./store.js";
export type { MemoryEntry, MemoryCatalogEntry, MemoryCategory, MemoryStatus } from "./types.js";
