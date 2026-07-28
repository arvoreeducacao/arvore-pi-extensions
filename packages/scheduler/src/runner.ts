import { spawn } from "node:child_process";
import type { ScheduledTask, ScheduledTaskRunContext } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const OUTPUT_TAIL_LIMIT = 2000;
const KILL_GRACE_MS = 5000;

export type RunnerDeps = {
  isLiveSession: (sessionId: string | undefined) => boolean;
  deliverToLiveSession: (prompt: string) => void;
};

export function createPiRunner(deps: RunnerDeps) {
  return async (task: ScheduledTask, run: ScheduledTaskRunContext): Promise<void> => {
    if (task.delivery === "origin-session" && deps.isLiveSession(task.originSessionId)) {
      deps.deliverToLiveSession(task.prompt);
      return;
    }
    const output = await runHeadlessPi(task, run);
    if (output.code !== 0 && !output.timedOut) {
      throw new Error(
        `Headless run exited with code ${output.code ?? "unknown"}: ${tail(output.stderr || output.stdout)}`,
      );
    }
    if (output.timedOut) {
      throw new Error(`Headless run timed out after ${task.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`);
    }
  };
}

function runHeadlessPi(
  task: ScheduledTask,
  run: ScheduledTaskRunContext,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const args = buildPiArgs(task);
    const child = spawn(process.execPath, args, {
      cwd: task.cwd,
      env: {
        ...process.env,
        PI_SCHEDULED_RUN: "1",
        PI_SCHEDULED_TASK_ID: task.id,
        PI_SCHEDULED_RUN_ID: run.historyEntryId,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);

    const timeoutMs = task.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function buildPiArgs(task: ScheduledTask): string[] {
  const args = [resolvePiCliEntry(), "--print"];
  if (task.delivery === "origin-session" && task.originSessionId) {
    args.push("--session", task.originSessionId);
  }
  args.push(task.prompt);
  return args;
}

function resolvePiCliEntry(): string {
  const entry = process.argv[1];
  if (!entry) {
    throw new Error("Could not resolve the pi CLI entry point from process.argv");
  }
  return entry;
}

function tail(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= OUTPUT_TAIL_LIMIT) {
    return trimmed;
  }
  return `…${trimmed.slice(-OUTPUT_TAIL_LIMIT)}`;
}
