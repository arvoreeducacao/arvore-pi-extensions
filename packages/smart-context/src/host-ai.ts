import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

type CompleteFn = (
  model: any,
  context: { messages: any[]; systemPrompt?: string },
  options: { apiKey?: string; headers?: Record<string, string>; maxTokens?: number; signal?: AbortSignal }
) => Promise<{ content: Array<{ type: string; text?: string }> }>;

let cached: CompleteFn | null | undefined;
let lastDiag = "";

export function getDiagnostics(): string {
  return lastDiag;
}

function collectCandidateDirs(): string[] {
  const dirs = new Set<string>();
  const seeds: string[] = [];

  if (process.argv[1]) seeds.push(process.argv[1]);
  for (const p of process.argv) {
    if (typeof p === "string" && (p.includes("pi-coding-agent") || p.endsWith("/pi"))) {
      seeds.push(p);
    }
  }
  try {
    seeds.push(new URL(import.meta.url).pathname);
  } catch {
    // ignore
  }

  const resolvedSeeds = new Set<string>();
  for (const seed of seeds) {
    resolvedSeeds.add(seed);
    try {
      resolvedSeeds.add(realpathSync(seed));
    } catch {
      // ignore
    }
  }

  for (const seed of resolvedSeeds) {
    let dir = dirname(seed);
    for (let i = 0; i < 10; i++) {
      dirs.add(dir);
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return Array.from(dirs);
}

function findPiAiEntries(): string[] {
  const found = new Set<string>();
  for (const dir of collectCandidateDirs()) {
    const candidate = join(dir, "node_modules", "@earendil-works", "pi-ai", "dist", "index.js");
    if (existsSync(candidate)) found.add(candidate);
  }
  try {
    const req = createRequire(import.meta.url);
    const resolved = req.resolve("@earendil-works/pi-ai/package.json");
    const entry = join(dirname(resolved), "dist", "index.js");
    if (existsSync(entry)) found.add(entry);
  } catch {
    // ignore
  }
  return Array.from(found);
}

export async function getComplete(): Promise<CompleteFn | null> {
  if (cached !== undefined) return cached;

  const entries = findPiAiEntries();
  const diag: string[] = [`argv1=${process.argv[1] ?? "?"}`, `entries=${entries.length}`];

  let withRegistry: CompleteFn | null = null;
  let anyComplete: CompleteFn | null = null;

  for (const entry of entries) {
    try {
      const mod = await import(pathToFileURL(entry).href);
      if (typeof mod.complete !== "function") continue;
      anyComplete = mod.complete as CompleteFn;
      const getProvider = mod.getApiProvider as ((api: string) => unknown) | undefined;
      const hasKiro = typeof getProvider === "function" && getProvider("kiro-api");
      diag.push(`${entry.includes(".pi/npm") ? "pi-npm" : entry.includes("pi-coding-agent") ? "host" : "local"}:kiro=${hasKiro ? "yes" : "no"}`);
      if (hasKiro) {
        withRegistry = mod.complete as CompleteFn;
        break;
      }
    } catch (err) {
      diag.push(`err:${err instanceof Error ? err.message.slice(0, 40) : "?"}`);
    }
  }

  lastDiag = diag.join(" | ");
  cached = withRegistry ?? anyComplete;
  return cached;
}
