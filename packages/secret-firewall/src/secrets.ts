import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface SecretEntry {
  name: string;
  placeholder: string;
  value: string;
  source: "env" | "dotenv" | "pattern";
}

export interface CustomPatternConfig {
  name: string;
  regex: string;
  flags?: string;
}

export interface FirewallConfig {
  patterns: CustomPatternConfig[];
}

const SENSITIVE_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PWD|API[_-]?KEY|APIKEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|AUTH|CREDENTIAL|DSN|DATABASE_URL|CONNECTION_STRING|SESSION|COOKIE|SIGNING|ENCRYPT|SALT|BEARER)/i;

const NEVER_SENSITIVE = /^(PATH|HOME|SHELL|PWD|OLDPWD|LANG|LC_|TERM|USER|LOGNAME|HOSTNAME|TMPDIR|EDITOR|PAGER|NODE_ENV|NODE_OPTIONS|npm_|PNPM_|COLORTERM|SHLVL|SSH_AUTH_SOCK|SSH_AGENT_PID|__MISE|MISE_|WARP_|XPC_|__CF|SECURITYSESSIONID|TERM_SESSION_ID|_$)/;

const SESSION_LIKE_NAME = /(SESSION|SOCK|UUID|_PID)$/i;

const MIN_VALUE_LENGTH = 8;
const TRIVIAL_VALUE = /^(true|false|null|undefined|none|localhost|0|1|3000|8080|development|production|staging|test)$/i;

const DOTENV_FILES = [".env", ".env.local", ".env.development", ".env.development.local"];

const DOTENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

function unquote(raw: string): string {
  const v = raw.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  const hash = v.indexOf(" #");
  return hash >= 0 ? v.slice(0, hash).trim() : v;
}

function isSensitiveValue(name: string, value: string): boolean {
  if (NEVER_SENSITIVE.test(name)) return false;
  if (SESSION_LIKE_NAME.test(name)) return false;
  if (!value || value.length < MIN_VALUE_LENGTH) return false;
  if (TRIVIAL_VALUE.test(value)) return false;
  return SENSITIVE_NAME.test(name);
}

function toPlaceholder(name: string, taken: Set<string>): string {
  const shellVar = name.replace(/[^A-Za-z0-9_]/g, "_");
  const make = (tag: string) =>
    `«SECRET ${name}${tag} redacted — the real value is live in your shell env; read it in bash as "$${shellVar}"»`;
  const base = make("");
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(make(`#${i}`))) i++;
  return make(`#${i}`);
}

function parseDotenv(path: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const m = DOTENV_LINE.exec(line);
      if (!m) continue;
      out.set(m[1], unquote(m[2]));
    }
  } catch {
    /* unreadable file, skip */
  }
  return out;
}

const CONFIG_FILENAME = "secret-firewall.json";

function configPaths(cwd: string): string[] {
  return [join(homedir(), ".pi", "agent", CONFIG_FILENAME), join(cwd, ".pi", CONFIG_FILENAME)];
}

function parsePatterns(raw: unknown): CustomPatternConfig[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as Record<string, unknown>).patterns;
  if (!Array.isArray(list)) return [];
  const out: CustomPatternConfig[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    if (typeof p.regex !== "string" || p.regex.length === 0) continue;
    out.push({
      name: typeof p.name === "string" && p.name.length > 0 ? p.name : "CUSTOM",
      regex: p.regex,
      flags: typeof p.flags === "string" ? p.flags : undefined,
    });
  }
  return out;
}

export function loadCustomPatterns(cwd: string): CustomPatternConfig[] {
  const merged: CustomPatternConfig[] = [];
  for (const path of configPaths(cwd)) {
    if (!existsSync(path)) continue;
    try {
      merged.push(...parsePatterns(JSON.parse(readFileSync(path, "utf8"))));
    } catch {
      /* unreadable or invalid JSON, skip */
    }
  }
  return merged;
}

export function discoverSecrets(cwd: string): SecretEntry[] {
  const byName = new Map<string, { value: string; source: SecretEntry["source"] }>();

  for (const [name, value] of Object.entries(process.env)) {
    if (typeof value === "string" && isSensitiveValue(name, value)) {
      byName.set(name, { value, source: "env" });
    }
  }

  for (const file of DOTENV_FILES) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;
    for (const [name, value] of parseDotenv(path)) {
      if (isSensitiveValue(name, value) && !byName.has(name)) {
        byName.set(name, { value, source: "dotenv" });
      }
    }
  }

  const taken = new Set<string>();
  const entries: SecretEntry[] = [];
  for (const [name, { value, source }] of byName) {
    if (!value) continue;
    const placeholder = toPlaceholder(name, taken);
    taken.add(placeholder);
    entries.push({ name, placeholder, value, source });
  }

  entries.sort((a, b) => b.value.length - a.value.length);
  return entries;
}
