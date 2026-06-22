import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { GitProviderConfig } from "../config.js";
import { configDir } from "../config.js";
import { copyInto, listJsonlIn } from "./mirror.js";
import type { RemoteFile, SyncProvider } from "./types.js";

const exec = promisify(execFile);

const nonInteractiveEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
  GCM_INTERACTIVE: "never",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
};

const nonInteractiveOptions = {
  maxBuffer: 32 * 1024 * 1024,
  env: nonInteractiveEnv,
};

function isGithubHttpsRepo(repo: string): boolean {
  return /^https:\/\/github\.com\//i.test(repo);
}

async function resolveGithubToken(): Promise<string> {
  const fromGh = await exec("gh", ["auth", "token"], { env: process.env })
    .then(({ stdout }) => stdout.trim())
    .catch(() => "");
  if (fromGh) return fromGh;
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
}

export class GitProvider implements SyncProvider {
  readonly kind = "git";
  private readonly repo: string;
  private readonly branch: string;
  private readonly remoteName: string;
  private readonly clonePath: string;
  private cachedToken: string | null = null;

  constructor(config: GitProviderConfig) {
    this.repo = config.repo;
    this.branch = config.branch;
    this.remoteName = config.remoteName;
    this.clonePath = join(configDir(), "cloud-sessions", "repo");
  }

  private async authArgs(): Promise<string[]> {
    if (!isGithubHttpsRepo(this.repo)) return [];
    if (this.cachedToken === null) {
      this.cachedToken = await resolveGithubToken();
    }
    if (!this.cachedToken) return [];
    const header = `AUTHORIZATION: basic ${Buffer.from(
      `x-access-token:${this.cachedToken}`,
    ).toString("base64")}`;
    return ["-c", `http.extraheader=${header}`];
  }

  private async git(args: string[]): Promise<string> {
    const { stdout } = await exec(
      "git",
      ["-C", this.clonePath, ...args],
      nonInteractiveOptions,
    );
    return stdout.trim();
  }

  private async gitNetwork(args: string[]): Promise<string> {
    const auth = await this.authArgs();
    return this.git([...auth, ...args]);
  }

  private isCloned(): boolean {
    return existsSync(join(this.clonePath, ".git"));
  }

  async ensureReady(): Promise<void> {
    if (this.isCloned()) {
      const currentRemote = await this.git(["remote", "get-url", this.remoteName]).catch(() => "");
      if (currentRemote && currentRemote !== this.repo) {
        throw new Error(
          `cloud-sessions clone at ${this.clonePath} points to ${currentRemote}, not ${this.repo}. ` +
            `Remove it to re-clone, or revert the repo setting.`,
        );
      }
      await this.configureIdentity();
      await this.git(["checkout", "-B", this.branch]).catch(() => "");
      return;
    }
    await mkdir(join(configDir(), "cloud-sessions"), { recursive: true });
    const auth = await this.authArgs();
    const cloned = await exec(
      "git",
      [...auth, "clone", "--branch", this.branch, this.repo, this.clonePath],
      nonInteractiveOptions,
    )
      .then(() => true)
      .catch(() =>
        exec("git", [...auth, "clone", this.repo, this.clonePath], nonInteractiveOptions)
          .then(() => true)
          .catch(() => false),
      );
    if (!cloned) {
      await exec("git", ["init", this.clonePath], nonInteractiveOptions);
      await this.git(["remote", "add", this.remoteName, this.repo]);
    }
    await this.configureIdentity();
    await this.git(["checkout", "-B", this.branch]).catch(() => "");
  }

  private async configureIdentity(): Promise<void> {
    await this.git(["config", "user.name", "pi-cloud-sessions"]).catch(() => "");
    await this.git(["config", "user.email", "pi-cloud-sessions@local"]).catch(() => "");
  }

  async pull(): Promise<void> {
    await this.ensureReady();
    await this.gitNetwork(["fetch", this.remoteName, this.branch]).catch(() => "");
    await this.git(["reset", "--hard", `${this.remoteName}/${this.branch}`]).catch(() => "");
  }

  async listRemote(): Promise<RemoteFile[]> {
    return listJsonlIn(this.clonePath);
  }

  mirrorPath(relativePath: string): string {
    return join(this.clonePath, relativePath);
  }

  async stageFromLocal(relativePath: string, localAbsolutePath: string): Promise<void> {
    await copyInto(this.clonePath, relativePath, localAbsolutePath);
  }

  async push(message: string): Promise<void> {
    await this.git(["add", "-A"]);
    const status = await this.git(["status", "--porcelain"]);
    if (status.length === 0) return;
    await this.git(["commit", "-m", message]);
    await this.gitNetwork(["push", this.remoteName, `HEAD:${this.branch}`]);
  }
}
