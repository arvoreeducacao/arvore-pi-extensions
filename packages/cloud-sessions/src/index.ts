import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  configFilePath,
  isProviderConfigured,
  loadConfig,
  type CloudSessionsConfig,
} from "./config.js";
import { Sync, type SyncResult } from "./sync.js";

const STATUS_KEY = "cloud-sessions";

let syncing = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

type Notify = (key: string, text: string | undefined) => void;

function summarize(result: SyncResult): string {
  const parts: string[] = [];
  if (result.pushed.length) parts.push(`↑${result.pushed.length}`);
  if (result.pulled.length) parts.push(`↓${result.pulled.length}`);
  if (parts.length === 0) return "up to date";
  return parts.join(" ");
}

async function runSync(setStatus: Notify): Promise<SyncResult | null> {
  if (syncing) return null;
  syncing = true;
  try {
    const config = await loadConfig();
    if (!isProviderConfigured(config)) {
      setStatus(STATUS_KEY, "sessions: not configured");
      return null;
    }
    setStatus(STATUS_KEY, `sessions: syncing (${config.provider})`);
    const sync = new Sync(config);
    const result = await sync.run();
    setStatus(STATUS_KEY, `sessions: ${config.provider} ${summarize(result)}`);
    return result;
  } catch (error) {
    setStatus(STATUS_KEY, "sessions: sync error");
    throw error;
  } finally {
    syncing = false;
  }
}

function scheduleSync(config: CloudSessionsConfig, setStatus: Notify): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runSync(setStatus).catch(() => {});
  }, config.pushDebounceMs);
}

function startPolling(config: CloudSessionsConfig, setStatus: Notify): void {
  if (pollTimer) clearInterval(pollTimer);
  if (config.pollIntervalMs <= 0) return;
  pollTimer = setInterval(() => {
    void runSync(setStatus).catch(() => {});
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
  await mkdir(dirname(configFilePath()), { recursive: true });
  await writeFile(configFilePath(), JSON.stringify(partial, null, 2));
}

export default function cloudSessions(pi: ExtensionAPI): void {
  pi.on("session_start", async (event, ctx) => {
    const config = await loadConfig();
    const setStatus: Notify = (k, t) => ctx.ui.setStatus(k, t);

    if (!isProviderConfigured(config)) {
      setStatus(STATUS_KEY, "sessions: not configured");
      return;
    }
    setStatus(STATUS_KEY, `sessions: ${config.provider}`);

    if (config.pullOnStart && event.reason === "startup") {
      await runSync(setStatus).catch((error) => {
        ctx.ui.notify(
          `cloud-sessions sync failed: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      });
    }

    startPolling(config, setStatus);
  });

  pi.on("session_before_switch", async (_event, ctx) => {
    const config = await loadConfig();
    if (!isProviderConfigured(config)) return;
    await runSync((k, t) => ctx.ui.setStatus(k, t)).catch(() => {});
  });

  pi.on("turn_end", async (_event, ctx) => {
    const config = await loadConfig();
    if (!config.autoPush || !isProviderConfigured(config)) return;
    scheduleSync(config, (k, t) => ctx.ui.setStatus(k, t));
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopTimers();
    const config = await loadConfig();
    if (!config.autoPush || !isProviderConfigured(config)) return;
    await runSync((k, t) => ctx.ui.setStatus(k, t)).catch(() => {});
  });

  pi.registerCommand("cloud-sessions-sync", {
    description: "Sync pi sessions with the cloud backend now (pull + push)",
    handler: async (_args, ctx) => {
      try {
        const result = await runSync((k, t) => ctx.ui.setStatus(k, t));
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

      ctx.ui.setStatus(STATUS_KEY, `sessions: ${provider}`);
    },
  });
}
