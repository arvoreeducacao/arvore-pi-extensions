import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitIdentity {
  name?: string;
  email?: string;
}

const AGENT_NAMES = new Set(["kiro", "pi", "claude", "assistant", "bot"]);

let cached: GitIdentity | null | undefined;

async function gitConfig(key: string, cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["config", "--get", key], { cwd });
    const value = stdout.trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveGitAuthor(cwd: string): Promise<string | undefined> {
  if (cached !== undefined) {
    return identityToAuthor(cached);
  }

  const [name, email] = await Promise.all([
    gitConfig("user.name", cwd),
    gitConfig("user.email", cwd),
  ]);

  cached = name || email ? { name, email } : null;
  return identityToAuthor(cached);
}

function identityToAuthor(identity: GitIdentity | null): string | undefined {
  if (!identity) return undefined;
  if (identity.name && AGENT_NAMES.has(identity.name.toLowerCase())) {
    return identity.email;
  }
  return identity.name || identity.email;
}
