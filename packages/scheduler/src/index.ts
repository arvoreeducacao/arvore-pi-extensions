import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import path from "node:path";
import { createPiRunner } from "./runner.js";
import { PersistentTaskScheduler } from "./scheduler.js";
import { FileSchedulerLock, JsonScheduledTaskStore } from "./store.js";
import { createSchedulerTools } from "./tools.js";
import type { ScheduledTask, TaskScheduler } from "./types.js";

const STATUS_KEY = "scheduler";
const ENV_DATA_DIR = "PI_SCHEDULER_DATA_DIR";
const ENV_SCHEDULED_RUN = "PI_SCHEDULED_RUN";

function resolveDataDir(): string {
  return (
    process.env[ENV_DATA_DIR]?.trim() || path.join(homedir(), ".pi", "agent", "scheduler")
  );
}

export default function extension(pi: ExtensionAPI): void {
  let scheduler: TaskScheduler | undefined;
  let liveSessionId: string | undefined;

  const refreshStatus = async (ctx: ExtensionContext) => {
    if (!ctx.hasUI) {
      return;
    }
    if (!scheduler) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    if (!scheduler.isActive()) {
      ctx.ui.setStatus(STATUS_KEY, "scheduler: idle (lock held elsewhere)");
      return;
    }
    const tasks = await scheduler.list();
    const enabled = tasks.filter((t) => t.enabled).length;
    ctx.ui.setStatus(STATUS_KEY, `scheduler: ${enabled} task${enabled === 1 ? "" : "s"}`);
  };

  pi.on("session_start", async (_event, ctx) => {
    liveSessionId = safeSessionId(ctx);
    if (process.env[ENV_SCHEDULED_RUN] === "1") {
      return;
    }
    if (scheduler) {
      await refreshStatus(ctx);
      return;
    }
    const dataDir = resolveDataDir();
    const runner = createPiRunner({
      isLiveSession: (sessionId) => sessionId !== undefined && sessionId === liveSessionId,
      deliverToLiveSession: (prompt) => {
        pi.sendUserMessage(prompt, { deliverAs: "followUp" });
      },
    });
    const instance = new PersistentTaskScheduler(
      new JsonScheduledTaskStore(path.join(dataDir, "tasks.json")),
      new FileSchedulerLock(path.join(dataDir, "scheduler.lock")),
      runner,
    );
    await instance.start();
    scheduler = instance;
    for (const tool of createSchedulerTools(scheduler)) {
      pi.registerTool(tool);
    }
    await refreshStatus(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    liveSessionId = safeSessionId(ctx);
  });

  pi.on("session_shutdown", async () => {
    await scheduler?.stop();
    scheduler = undefined;
    liveSessionId = undefined;
  });

  pi.registerCommand("cron", {
    description:
      "Manage scheduled tasks. Subcommands: status, list, get, run, enable, disable, delete.",
    getArgumentCompletions: (prefix) => {
      const subcommands = ["status", "list", "get", "run", "enable", "disable", "delete"];
      const matches = subcommands.filter((s) => s.startsWith(prefix.trim().toLowerCase()));
      return matches.map((s) => ({ label: s, value: s }));
    },
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }
      if (!scheduler) {
        ctx.ui.notify("Task scheduler is not running.", "warning");
        return;
      }
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const subcommand = parts[0]?.toLowerCase() ?? "status";
      const rest = parts.slice(1).join(" ").trim();

      switch (subcommand) {
        case "status": {
          ctx.ui.notify(formatStatus(await scheduler.status()), "info");
          break;
        }
        case "list": {
          ctx.ui.notify(formatTaskList(await scheduler.list()), "info");
          break;
        }
        case "get": {
          if (!rest) {
            ctx.ui.notify("Usage: /cron get <task-id>", "warning");
            break;
          }
          const task = await scheduler.get(rest);
          ctx.ui.notify(
            task ? formatTaskDetail(task) : `Task not found: ${rest}`,
            task ? "info" : "error",
          );
          break;
        }
        case "run": {
          if (!rest) {
            ctx.ui.notify("Usage: /cron run <task-id>", "warning");
            break;
          }
          const task = await scheduler.runNow(rest);
          ctx.ui.notify(
            task ? `Triggered: ${task.name ?? task.id}` : `Task not found: ${rest}`,
            task ? "info" : "error",
          );
          break;
        }
        case "enable":
        case "disable": {
          if (!rest) {
            ctx.ui.notify(`Usage: /cron ${subcommand} <task-id>`, "warning");
            break;
          }
          const task = await scheduler.update(rest, { enabled: subcommand === "enable" });
          ctx.ui.notify(
            task
              ? `${subcommand === "enable" ? "Enabled" : "Disabled"}: ${task.name ?? task.id}`
              : `Task not found: ${rest}`,
            task ? "info" : "error",
          );
          break;
        }
        case "delete": {
          if (!rest) {
            ctx.ui.notify("Usage: /cron delete <task-id>", "warning");
            break;
          }
          const deleted = await scheduler.delete(rest);
          ctx.ui.notify(
            deleted ? `Deleted: ${rest}` : `Task not found: ${rest}`,
            deleted ? "info" : "error",
          );
          break;
        }
        default:
          ctx.ui.notify(
            "Unknown subcommand. Available: status, list, get, run, enable, disable, delete.",
            "warning",
          );
      }
    },
  });
}

function safeSessionId(ctx: ExtensionContext): string | undefined {
  try {
    return ctx.sessionManager.getSessionId();
  } catch {
    return undefined;
  }
}

function formatStatus(status: Awaited<ReturnType<TaskScheduler["status"]>>): string {
  const lines = [
    `Active: ${status.active}`,
    `Tasks: ${status.taskCount}`,
    `Timers: ${status.scheduledTimerCount}`,
    `Crons: ${status.scheduledCronCount}`,
  ];
  if (status.runningTaskIds.length > 0) {
    lines.push(`Running: ${status.runningTaskIds.join(", ")}`);
  }
  if (!status.lock.acquired && status.lock.holderPid !== undefined) {
    lines.push(`Lock held by pid ${status.lock.holderPid}`);
  }
  return lines.join("\n");
}

function formatTaskList(tasks: ScheduledTask[]): string {
  if (tasks.length === 0) {
    return "No scheduled tasks.";
  }
  return tasks
    .map((t) => {
      const name = t.name ?? t.id.slice(0, 8);
      const status = t.enabled ? (t.lastStatus ?? "pending") : "disabled";
      const next = t.nextRunAt ? ` next: ${t.nextRunAt}` : "";
      return `${t.id.slice(0, 8)} ${name} [${t.type}/${t.delivery}] ${status}${next}`;
    })
    .join("\n");
}

function formatTaskDetail(task: ScheduledTask): string {
  const lines = [
    `ID: ${task.id}`,
    `Name: ${task.name ?? "(unnamed)"}`,
    `Type: ${task.type}`,
    `Schedule: ${task.schedule}`,
    `Delivery: ${task.delivery}`,
    `Enabled: ${task.enabled}`,
    `Status: ${task.lastStatus ?? "pending"}`,
    `Runs: ${task.runCount}`,
  ];
  if (task.originSessionId) lines.push(`Origin session: ${task.originSessionId}`);
  if (task.nextRunAt) lines.push(`Next run: ${task.nextRunAt}`);
  if (task.lastError) lines.push(`Last error: ${task.lastError}`);
  lines.push(`Prompt: ${task.prompt}`);
  return lines.join("\n");
}
