import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

type CompleteFn = (
  model: any,
  context: { messages: any[]; systemPrompt?: string },
  options: { apiKey?: string; headers?: Record<string, string>; maxTokens?: number; signal?: AbortSignal }
) => Promise<{ content: Array<{ type: string; text?: string }> }>;

let cached: CompleteFn | null | undefined;

function hostPiAiEntry(): string | null {
  const hostCli = process.argv[1];
  if (!hostCli) return null;

  let dir = dirname(hostCli);
  for (let i = 0; i < 8; i++) {
    const candidate = join(
      dir,
      "node_modules",
      "@earendil-works",
      "pi-ai",
      "dist",
      "index.js"
    );
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function getComplete(): Promise<CompleteFn | null> {
  if (cached !== undefined) return cached;

  const entry = hostPiAiEntry();
  if (entry) {
    try {
      const mod = await import(pathToFileURL(entry).href);
      if (typeof mod.complete === "function") {
        cached = mod.complete as CompleteFn;
        return cached;
      }
    } catch {
      // fall through
    }
  }

  try {
    const req = createRequire(import.meta.url);
    const local = req.resolve("@earendil-works/pi-ai");
    const mod = await import(pathToFileURL(local).href);
    if (typeof mod.complete === "function") {
      cached = mod.complete as CompleteFn;
      return cached;
    }
  } catch {
    // ignore
  }

  cached = null;
  return cached;
}
