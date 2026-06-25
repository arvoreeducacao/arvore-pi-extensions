import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Complexity = "trivial" | "simple" | "medium" | "complex";

export interface ModelRef {
  provider: string;
  model: string;
}

export interface SmartContextConfig {
  classifier: ModelRef;
  routing: Record<Complexity, ModelRef>;
  largeContext: {
    thresholdTokens: number;
    model: ModelRef;
  };
}

const CONFIG_FILE = "smart-context.json";

const DEFAULT_CONFIG: SmartContextConfig = {
  classifier: { provider: "kiro", model: "claude-haiku-4-5" },
  routing: {
    trivial: { provider: "kiro", model: "claude-haiku-4-5" },
    simple: { provider: "kiro", model: "claude-sonnet-4-6" },
    medium: { provider: "kiro", model: "claude-opus-4-8" },
    complex: { provider: "kiro", model: "claude-opus-4-8" },
  },
  largeContext: {
    thresholdTokens: 500_000,
    model: { provider: "kiro", model: "claude-sonnet-4-6" },
  },
};

function findProjectRoot(cwd: string): string | null {
  let dir = cwd;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, ".pi")) || existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function configPath(cwd: string): string | null {
  const root = findProjectRoot(cwd);
  return root ? join(root, ".pi", CONFIG_FILE) : null;
}

function isModelRef(value: unknown): value is ModelRef {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ModelRef).provider === "string" &&
    typeof (value as ModelRef).model === "string"
  );
}

function mergeRef(base: ModelRef, raw: unknown): ModelRef {
  return isModelRef(raw) ? { provider: raw.provider, model: raw.model } : base;
}

function mergeConfig(base: SmartContextConfig, raw: Record<string, unknown>): SmartContextConfig {
  const rawRouting = (raw.routing ?? {}) as Record<string, unknown>;
  const rawLarge = (raw.largeContext ?? {}) as Record<string, unknown>;
  const threshold = rawLarge.thresholdTokens;

  return {
    classifier: mergeRef(base.classifier, raw.classifier),
    routing: {
      trivial: mergeRef(base.routing.trivial, rawRouting.trivial),
      simple: mergeRef(base.routing.simple, rawRouting.simple),
      medium: mergeRef(base.routing.medium, rawRouting.medium),
      complex: mergeRef(base.routing.complex, rawRouting.complex),
    },
    largeContext: {
      thresholdTokens:
        typeof threshold === "number" && Number.isFinite(threshold) && threshold > 0
          ? threshold
          : base.largeContext.thresholdTokens,
      model: mergeRef(base.largeContext.model, rawLarge.model),
    },
  };
}

let cached: SmartContextConfig | null = null;
let cachedKey: string | null = null;

export function loadConfig(cwd: string = process.cwd()): SmartContextConfig {
  const path = configPath(cwd);
  const key = path ?? cwd;
  if (cached && cachedKey === key) return cached;

  let resolved = DEFAULT_CONFIG;
  if (path && existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
      resolved = mergeConfig(DEFAULT_CONFIG, raw);
    } catch {
      resolved = DEFAULT_CONFIG;
    }
  }

  cached = resolved;
  cachedKey = key;
  return resolved;
}

export function configFilePath(cwd: string = process.cwd()): string | null {
  return configPath(cwd);
}

export function defaultConfig(): SmartContextConfig {
  return DEFAULT_CONFIG;
}
