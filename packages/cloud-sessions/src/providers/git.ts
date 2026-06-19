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

export class GitProvider implements SyncProvider {
  readonly kind = "git";
  private readonly repo: string;
  private readonly branch: string;
  private readonly remoteName: string;
  private readonly clonePath: string;

  constructor(config: GitProviderConfig) {
    this.repo = config.repo;
    this.branch = config.branch;
    this.remoteName = config.remoteName;
    this.clonePath = join(configDir(), "cloud-sessions", "repo");
  }

  private async git(args: string[]): Promise<string> {
    const { stdout } = await exec("git", ["-C", this.clonePath, ...args], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout.trim();
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
    await exec("git", ["clone", "--branch", this.branch, this.repo, this.clonePath]).catch(
      async () => {
        await exec("git", ["clone", this.repo, this.clonePath]);
        await this.git(["checkout", "-B", this.branch]);
      },
    );
    await this.configureIdentity();
  }

  private async configureIdentity(): Promise<void> {
    await this.git(["config", "user.name", "pi-cloud-sessions"]).catch(() => "");
    await this.git(["config", "user.email", "pi-cloud-sessions@local"]).catch(() => "");
  }

  async pull(): Promise<void> {
    await this.ensureReady();
    await this.git(["fetch", this.remoteName, this.branch]);
    await this.git(["reset", "--hard", `${this.remoteName}/${this.branch}`]);
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
    await this.git(["push", this.remoteName, `HEAD:${this.branch}`]);
  }
}
