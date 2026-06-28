import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  configFilePath,
  isProviderConfigured,
  loadConfig,
  readRawConfigFile,
  type CloudSessionsConfig,
} from "./config.js";
import { Sync, type SyncResult } from "./sync.js";

let activeSync: Promise<SyncResult | null> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

type NotifyUser = (text: string, level: "info" | "warning" | "error") => void;

let lastSyncFailed = false;

function shortReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const text = raw.toLowerCase();
  if (text.includes("could not read") || text.includes("authentication failed") || text.includes("403") || text.includes("401")) {
    return "auth failed (run `gh auth login`)";
  }
  if (text.includes("gh auth token") || text.includes("github_token") || text.includes("no token")) {
    return "no github token";
  }
  if (text.includes("could not resolve host") || text.includes("timed out") || text.includes("network")) {
    return "network unreachable";
  }
  if (text.includes("terminal prompts disabled")) {
    return "credentials required (run `gh auth login`)";
  }
  const firstLine = raw.split("\n")[0]?.trim() ?? raw;
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;
}

async function runSync(notifyUser?: NotifyUser): Promise<SyncResult | null> {
  if (activeSync) return activeSync;
  activeSync = (async () => {
    try {
      const config = await loadConfig();
      if (!isProviderConfigured(config)) {
        return null;
      }
      const sync = new Sync(config);
      const result = await sync.run();
      lastSyncFailed = false;
      return result;
    } catch (error) {
      const reason = shortReason(error);
      if (!lastSyncFailed) {
        notifyUser?.(`cloud-sessions sync failed: ${reason}`, "warning");
      }
      lastSyncFailed = true;
      throw error;
    } finally {
      activeSync = null;
    }
  })();
  return activeSync;
}

function scheduleSync(config: CloudSessionsConfig, notifyUser?: NotifyUser): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runSync(notifyUser).catch(() => {});
  }, config.pushDebounceMs);
}

function startPolling(config: CloudSessionsConfig, notifyUser?: NotifyUser): void {
  if (pollTimer) clearInterval(pollTimer);
  if (config.pollIntervalMs <= 0) return;
  pollTimer = setInterval(() => {
    void runSync(notifyUser).catch(() => {});
  }, config.pollIntervalMs);
  if (typeof pollTimer.unref === "function") pollTimer.unref();
}

function stopTimers(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function writeConfig(partial: Record<string, unknown>): Promise<void> {
  const current = await readRawConfigFile();
  const merged: Record<string, unknown> = { ...current, ...partial };
  if (partial.git || current.git) {
    merged.git = { ...(current.git as object), ...(partial.git as object) };
  }
  if (partial.icloud || current.icloud) {
    merged.icloud = { ...(current.icloud as object), ...(partial.icloud as object) };
  }
  await mkdir(dirname(configFilePath()), { recursive: true });
  await writeFile(configFilePath(), JSON.stringify(merged, null, 2));
}

export default function cloudSessions(pi: ExtensionAPI): void {
  pi.on("session_start", async (event, ctx) => {
    const config = await loadConfig();
    const notifyUser: NotifyUser = (text, level) => ctx.ui.notify(text, level);

    if (!isProviderConfigured(config)) {
      return;
    }

    if (config.pullOnStart && event.reason === "startup") {
      await runSync(notifyUser).catch(() => {});
    }

    startPolling(config, notifyUser);
  });

  pi.on("session_before_switch", async (_event, ctx) => {
    const config = await loadConfig();
    if (!isProviderConfigured(config)) return;
    await runSync(
      (text, level) => ctx.ui.notify(text, level),
    ).catch(() => {});
  });

  pi.on("turn_end", async (_event, ctx) => {
    const config = await loadConfig();
    if (!config.autoPush || !isProviderConfigured(config)) return;
    scheduleSync(
      config,
      (text, level) => ctx.ui.notify(text, level),
    );
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopTimers();
    const config = await loadConfig();
    if (!config.autoPush || !isProviderConfigured(config)) return;
    await runSync(
      (text, level) => ctx.ui.notify(text, level),
    ).catch(() => {});
  });

  pi.registerCommand("cloud-sessions-sync", {
    description: "Sync pi sessions with the cloud backend now (pull + push)",
    handler: async (_args, ctx) => {
      try {
        const result = await runSync((text, level) => ctx.ui.notify(text, level));
        if (!result) {
          ctx.ui.notify(
            "cloud-sessions is not configured. Run /cloud-sessions-setup.",
            "warning",
          );
          return;
        }
        ctx.ui.notify(
          `Synced: ${result.pushed.length} pushed, ${result.pulled.length} pulled, ${result.unchanged} unchanged.`,
          "info",
        );
      } catch (error) {
        ctx.ui.notify(
          `Sync failed: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      }
    },
  });

  pi.registerCommand("cloud-sessions-status", {
    description: "Show cloud-sessions configuration and status",
    handler: async (_args, ctx) => {
      const config = await loadConfig();
      const lines = [
        `provider: ${config.provider}`,
        `configured: ${isProviderConfigured(config) ? "yes" : "no"}`,
        `autoPush: ${config.autoPush}`,
        `pullOnStart: ${config.pullOnStart}`,
        `pollIntervalMs: ${config.pollIntervalMs}`,
        `machineId: ${config.machineId}`,
        config.provider === "git"
          ? `git repo: ${config.git.repo || "(unset)"} [${config.git.branch}]`
          : `icloud dir: ${config.icloud.dir}`,
        `config file: ${configFilePath()}`,
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("cloud-sessions-setup", {
    description: "Configure the cloud-sessions backend (git repo or iCloud folder)",
    handler: async (_args, ctx) => {
      const provider = await ctx.ui.select(
        "Cloud sessions backend",
        ["git", "icloud"],
      );
      if (!provider) return;

      if (provider === "git") {
        const repo = await ctx.ui.input(
          "Private git repo URL",
          "git@github.com:you/pi-sessions.git",
        );
        if (!repo) {
          ctx.ui.notify("Setup cancelled: repo is required.", "warning");
          return;
        }
        const branch = (await ctx.ui.input("Branch", "main")) || "main";
        await writeConfig({ provider: "git", git: { repo, branch } });
        ctx.ui.notify(
          `Saved git backend to ${configFilePath()}. Syncing automatically from now on.`,
          "info",
        );
      } else {
        const config = await loadConfig();
        const dir =
          (await ctx.ui.input("iCloud sessions folder", config.icloud.dir)) ||
          config.icloud.dir;
        await writeConfig({ provider: "icloud", icloud: { dir } });
        ctx.ui.notify(
          `Saved iCloud backend to ${configFilePath()}. Syncing automatically from now on.`,
          "info",
        );
      }
    },
  });
}
