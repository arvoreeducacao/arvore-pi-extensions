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

function findCompatEntries(): string[] {
  const found = new Set<string>();

  const fromDir = (dir: string) => {
    const base = join(dir, "node_modules", "@earendil-works", "pi-ai", "dist");
    const compat = join(base, "compat.js");
    if (existsSync(compat)) found.add(compat);
    const index = join(base, "index.js");
    if (existsSync(index)) found.add(index);
  };

  for (const dir of collectCandidateDirs()) fromDir(dir);

  try {
    const req = createRequire(import.meta.url);
    const pkg = req.resolve("@earendil-works/pi-ai/package.json");
    const base = join(dirname(pkg), "dist");
    if (existsSync(join(base, "compat.js"))) found.add(join(base, "compat.js"));
    if (existsSync(join(base, "index.js"))) found.add(join(base, "index.js"));
  } catch {
    // ignore
  }

  return Array.from(found).sort((a, b) => {
    const score = (p: string) =>
      (p.includes("pi-coding-agent") ? -100 : 0) + (p.endsWith("compat.js") ? -10 : 0);
    return score(a) - score(b);
  });
}

function tag(entry: string): string {
  const base = entry.endsWith("compat.js") ? "compat" : "index";
  const loc = entry.includes("pi-coding-agent")
    ? "host"
    : entry.includes(".pi/npm")
      ? "pi-npm"
      : "local";
  return `${loc}/${base}`;
}

export async function getComplete(): Promise<CompleteFn | null> {
  if (cached !== undefined) return cached;

  const entries = findCompatEntries();
  const diag: string[] = [`argv1=${process.argv[1] ?? "?"}`, `entries=${entries.length}`];

  let withRegistry: CompleteFn | null = null;
  let anyComplete: CompleteFn | null = null;

  for (const entry of entries) {
    try {
      const mod = await import(pathToFileURL(entry).href);
      const completeFn =
        typeof mod.complete === "function"
          ? (mod.complete as CompleteFn)
          : typeof mod.completeSimple === "function"
            ? (mod.completeSimple as CompleteFn)
            : null;
      if (!completeFn) {
        diag.push(`${tag(entry)}:no-complete`);
        continue;
      }
      anyComplete ??= completeFn;
      const getProvider = mod.getApiProvider as ((api: string) => unknown) | undefined;
      let hasKiro = false;
      if (typeof getProvider === "function") {
        try {
          hasKiro = Boolean(getProvider("kiro-api"));
        } catch {
          hasKiro = false;
        }
      }
      diag.push(`${tag(entry)}:kiro=${hasKiro ? "yes" : "no"}`);
      if (hasKiro) {
        withRegistry = completeFn;
        break;
      }
    } catch (err) {
      diag.push(`${tag(entry)}:err:${err instanceof Error ? err.message.slice(0, 40) : "?"}`);
    }
  }

  lastDiag = diag.join(" | ");
  cached = withRegistry ?? anyComplete;
  return cached;
}
