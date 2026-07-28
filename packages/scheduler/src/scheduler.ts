import { randomUUID } from "node:crypto";
import { Cron } from "croner";
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskRunHistoryEntry,
  ScheduledTaskRunner,
  ScheduledTaskStore,
  ScheduledTaskType,
  ScheduledTaskUpdate,
  SchedulerLock,
  TaskScheduler,
  TaskSchedulerStatus,
} from "./types.js";

const RUN_HISTORY_LIMIT = 25;

export class PersistentTaskScheduler implements TaskScheduler {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly crons = new Map<string, Cron>();
  private readonly runningTaskIds = new Set<string>();
  private active = false;

  constructor(
    private readonly store: ScheduledTaskStore,
    private readonly lock: SchedulerLock,
    private readonly runner: ScheduledTaskRunner,
  ) {}

  async list(): Promise<ScheduledTask[]> {
    return await this.store.list();
  }

  async get(taskId: string): Promise<ScheduledTask | undefined> {
    return await this.store.get(taskId);
  }

  async status(): Promise<TaskSchedulerStatus> {
    const tasks = await this.store.list();
    const holderPid = this.lock.holderPid();
    const lock: TaskSchedulerStatus["lock"] = {
      path: this.lock.path,
      acquired: this.lock.isAcquired(),
    };
    if (holderPid !== undefined) {
      lock.holderPid = holderPid;
    }
    return {
      active: this.active,
      pid: process.pid,
      taskCount: tasks.length,
      scheduledTimerCount: this.timers.size,
      scheduledCronCount: this.crons.size,
      runningTaskIds: [...this.runningTaskIds],
      lock,
    };
  }

  isActive(): boolean {
    return this.active;
  }

  async create(input: ScheduledTaskCreateInput): Promise<ScheduledTask> {
    const now = new Date().toISOString();
    const task = withNextRun({
      id: randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
      runCount: 0,
      runHistory:
        input.enabled === false ? [createTaskHistoryEntry("paused", "Created paused")] : [],
    });
    const created = await this.store.create(task);
    if (this.active) {
      this.schedule(created);
    }
    return created;
  }

  async update(
    taskId: string,
    input: ScheduledTaskUpdate,
  ): Promise<ScheduledTask | undefined> {
    const existing = await this.store.get(taskId);
    if (!existing) {
      return undefined;
    }
    const nextTask: ScheduledTask = {
      ...existing,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    if (Object.hasOwn(input, "name") && input.name === undefined) {
      delete nextTask.name;
    }
    if (Object.hasOwn(input, "originSessionId") && input.originSessionId === undefined) {
      delete nextTask.originSessionId;
    }
    if (input.enabled !== undefined && input.enabled !== existing.enabled) {
      nextTask.runHistory = appendTaskHistory(
        existing.runHistory,
        input.enabled
          ? createTaskHistoryEntry("resumed", "Task resumed")
          : createTaskHistoryEntry("paused", "Task paused"),
      );
    }
    const task = withNextRun(nextTask);
    if (input.enabled !== false && existing.lastStatus === "error") {
      delete task.lastError;
    }
    const updated = await this.store.update(taskId, task);
    if (this.active && updated) {
      this.schedule(updated);
    }
    return updated;
  }

  async delete(taskId: string): Promise<boolean> {
    this.unschedule(taskId);
    return await this.store.delete(taskId);
  }

  async runNow(taskId: string): Promise<ScheduledTask | undefined> {
    const task = await this.store.get(taskId);
    if (!task) {
      return undefined;
    }
    void this.execute(taskId);
    return task;
  }

  async start(): Promise<void> {
    if (this.active) {
      return;
    }
    if (!this.lock.acquire()) {
      return;
    }
    this.active = true;
    const tasks = await this.store.list();
    for (const task of tasks) {
      if (task.lastStatus === "running") {
        const fixed = withNextRun({
          ...task,
          lastStatus: "error" as const,
          lastError: "Process was interrupted while task was running",
          runHistory: updateTaskHistoryEntry(
            task.runHistory,
            findLastRunningEntryId(task.runHistory),
            { status: "error", message: "Process was interrupted while task was running" },
          ),
          updatedAt: new Date().toISOString(),
        });
        await this.store.update(task.id, fixed).catch(() => undefined);
        this.schedule(fixed);
      } else {
        const refreshed = withNextRun(task);
        if (refreshed.nextRunAt !== task.nextRunAt) {
          await this.store.update(task.id, refreshed).catch(() => undefined);
        }
        this.schedule(refreshed);
      }
    }
  }

  async stop(): Promise<void> {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    for (const cron of this.crons.values()) {
      cron.stop();
    }
    this.timers.clear();
    this.crons.clear();
    this.active = false;
    this.lock.release();
  }

  private schedule(task: ScheduledTask): void {
    this.unschedule(task.id);
    if (!this.active || !task.enabled) {
      return;
    }
    if (task.type === "cron") {
      try {
        const cron = new Cron(task.schedule, { unref: true }, () => {
          void this.execute(task.id);
        });
        this.crons.set(task.id, cron);
        void this.refreshNextRun(task.id, cron.nextRun()?.toISOString());
      } catch (error) {
        void this.markScheduleError(task.id, error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (task.type === "once") {
      const target = new Date(task.schedule);
      const delayMs = target.getTime() - Date.now();
      if (!Number.isFinite(delayMs) || delayMs <= 0) {
        void this.markScheduleError(task.id, `Scheduled time ${task.schedule} is in the past`);
        return;
      }
      const timer = setTimeout(() => {
        void this.execute(task.id);
      }, delayMs);
      timer.unref();
      this.timers.set(task.id, timer);
      void this.refreshNextRun(task.id, target.toISOString());
      return;
    }
    const timer = setInterval(() => {
      void this.execute(task.id);
    }, task.intervalSeconds * 1000);
    timer.unref();
    this.timers.set(task.id, timer);
    void this.refreshNextRun(
      task.id,
      new Date(Date.now() + task.intervalSeconds * 1000).toISOString(),
    );
  }

  private async execute(taskId: string): Promise<void> {
    if (!this.active || this.runningTaskIds.has(taskId)) {
      return;
    }
    const task = await this.store.get(taskId);
    if (!task?.enabled) {
      return;
    }
    this.runningTaskIds.add(taskId);
    const startedAt = new Date().toISOString();
    const runSessionId = createRunSessionId();
    const runningEntry = createTaskHistoryEntry("running", "Run started", {
      createdAt: startedAt,
      sessionId: runSessionId,
    });
    const runningTask: ScheduledTask = {
      ...task,
      lastStatus: "running",
      runHistory: appendTaskHistory(task.runHistory, runningEntry),
      updatedAt: startedAt,
    };
    await this.store.update(taskId, runningTask);
    try {
      await this.runner(task, {
        historyEntryId: runningEntry.id,
        sessionId: runSessionId,
        startedAt,
      });
      const latest = (await this.store.get(taskId)) ?? runningTask;
      const completedAt = new Date().toISOString();
      const updated = withNextRun({
        ...latest,
        enabled: latest.type === "once" ? false : latest.enabled,
        lastRunAt: completedAt,
        lastStatus: "success" as const,
        runHistory: updateTaskHistoryEntry(latest.runHistory, runningEntry.id, {
          status: "success",
          message: "Run completed",
        }),
        runCount: latest.runCount + 1,
        updatedAt: completedAt,
      });
      delete updated.lastError;
      await this.store.update(taskId, updated);
      if (updated.type === "once") {
        this.unschedule(taskId);
      }
    } catch (error) {
      const latest = (await this.store.get(taskId)) ?? runningTask;
      const message = error instanceof Error ? error.message : String(error);
      const updated = withNextRun({
        ...latest,
        lastStatus: "error" as const,
        lastError: message,
        runHistory: updateTaskHistoryEntry(latest.runHistory, runningEntry.id, {
          status: "error",
          message,
        }),
        updatedAt: new Date().toISOString(),
      });
      await this.store.update(taskId, updated);
    } finally {
      this.runningTaskIds.delete(taskId);
    }
  }

  private unschedule(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      clearInterval(timer);
      this.timers.delete(taskId);
    }
    const cron = this.crons.get(taskId);
    if (cron) {
      cron.stop();
      this.crons.delete(taskId);
    }
  }

  private async refreshNextRun(taskId: string, nextRunAt: string | undefined): Promise<void> {
    const task = await this.store.get(taskId);
    if (!task || nextRunAt === task.nextRunAt) {
      return;
    }
    const updated = { ...task, updatedAt: new Date().toISOString() };
    if (nextRunAt) {
      updated.nextRunAt = nextRunAt;
    } else {
      delete updated.nextRunAt;
    }
    await this.store.update(taskId, updated);
  }

  private async markScheduleError(taskId: string, error: string): Promise<void> {
    const task = await this.store.get(taskId);
    if (!task) {
      return;
    }
    const updated = {
      ...task,
      enabled: false,
      lastStatus: "error" as const,
      lastError: error,
      runHistory: appendTaskHistory(task.runHistory, createTaskHistoryEntry("error", error)),
      updatedAt: new Date().toISOString(),
    };
    delete updated.nextRunAt;
    await this.store.update(taskId, updated);
  }
}

export function resolveScheduledTaskDefinition(input: {
  type?: ScheduledTaskType;
  schedule?: string;
}): Pick<ScheduledTask, "type" | "schedule" | "intervalSeconds"> {
  const type = input.type;
  if (type !== "cron" && type !== "once" && type !== "interval") {
    throw new Error("Scheduled task type is required and must be one of: cron, once, interval");
  }
  if (!input.schedule?.trim()) {
    throw new Error(`${type} scheduled tasks require schedule`);
  }
  if (type === "interval") {
    const intervalSeconds = parseIntervalSeconds(input.schedule);
    if (!intervalSeconds) {
      throw new Error(
        `Invalid interval schedule: ${input.schedule}. Use formats like "30s", "5m", or "1h".`,
      );
    }
    return { type, schedule: input.schedule.trim(), intervalSeconds };
  }
  if (type === "once") {
    const schedule = resolveOnceSchedule(input.schedule);
    const delaySeconds = Math.max(1, Math.ceil((new Date(schedule).getTime() - Date.now()) / 1000));
    return { type, schedule, intervalSeconds: delaySeconds };
  }
  validateCronSchedule(input.schedule);
  return { type, schedule: input.schedule.trim(), intervalSeconds: 0 };
}

export function computeNextRunAt(task: ScheduledTask): string | undefined {
  if (!task.enabled) {
    return undefined;
  }
  if (task.type === "interval") {
    return new Date(Date.now() + task.intervalSeconds * 1000).toISOString();
  }
  if (task.type === "once") {
    const target = new Date(task.schedule);
    if (Number.isNaN(target.getTime()) || target.getTime() <= Date.now()) {
      return undefined;
    }
    return target.toISOString();
  }
  try {
    const cron = new Cron(task.schedule, { paused: true });
    const next = cron.nextRun()?.toISOString();
    cron.stop();
    return next;
  } catch {
    return undefined;
  }
}

export function createTaskHistoryEntry(
  status: ScheduledTaskRunHistoryEntry["status"],
  message?: string,
  options: { createdAt?: string; sessionId?: string } = {},
): ScheduledTaskRunHistoryEntry {
  return {
    id: randomUUID(),
    status,
    createdAt: options.createdAt ?? new Date().toISOString(),
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(message ? { message } : {}),
  };
}

export function appendTaskHistory(
  history: ScheduledTaskRunHistoryEntry[] | undefined,
  entry: ScheduledTaskRunHistoryEntry,
): ScheduledTaskRunHistoryEntry[] {
  return [...(history ?? []), entry].slice(-RUN_HISTORY_LIMIT);
}

export function updateTaskHistoryEntry(
  history: ScheduledTaskRunHistoryEntry[] | undefined,
  entryId: string,
  patch: Pick<ScheduledTaskRunHistoryEntry, "status"> &
    Pick<Partial<ScheduledTaskRunHistoryEntry>, "message">,
): ScheduledTaskRunHistoryEntry[] {
  return (history ?? [])
    .map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry))
    .slice(-RUN_HISTORY_LIMIT);
}

export function createRunSessionId(): string {
  return `scheduled-run-${randomUUID()}`;
}

function withNextRun<T extends ScheduledTask>(task: T): T {
  const nextRunAt = computeNextRunAt(task);
  const result: T = { ...task };
  if (nextRunAt) {
    result.nextRunAt = nextRunAt;
  } else {
    delete result.nextRunAt;
  }
  return result;
}

function findLastRunningEntryId(history: ScheduledTaskRunHistoryEntry[] | undefined): string {
  const entries = history ?? [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.status === "running") {
      return entry.id;
    }
  }
  return "";
}

function sanitizeIntervalSeconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("intervalSeconds must be a positive number");
  }
  return Math.max(5, Math.floor(value));
}

function parseIntervalSeconds(value: string): number | undefined {
  const match = value.trim().match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    return undefined;
  }
  const amount = Number(match[1]);
  const unit = match[2] as string;
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
  };
  const multiplier = multipliers[unit];
  if (!Number.isFinite(amount) || !multiplier) {
    return undefined;
  }
  return sanitizeIntervalSeconds(amount * multiplier);
}

function resolveOnceSchedule(value: string): string {
  const relative = parseRelativeSchedule(value);
  if (relative) {
    return relative;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `Invalid once schedule: ${value}. Use an ISO timestamp or relative time like "+10m".`,
    );
  }
  if (date.getTime() <= Date.now()) {
    throw new Error(`Scheduled time is in the past: ${date.toISOString()}`);
  }
  return date.toISOString();
}

function parseRelativeSchedule(value: string): string | undefined {
  const match = value.trim().match(/^\+(\d+)(s|m|h|d)$/);
  if (!match) {
    return undefined;
  }
  const amount = Number(match[1]);
  const unit = match[2] as string;
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  const multiplier = multipliers[unit];
  if (!Number.isFinite(amount) || !multiplier || amount <= 0) {
    return undefined;
  }
  return new Date(Date.now() + amount * multiplier).toISOString();
}

function validateCronSchedule(value: string): void {
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) {
    throw new Error(`Cron schedule must have 5 or 6 fields, got ${fields.length}`);
  }
  const cron = new Cron(value.trim(), { paused: true });
  cron.stop();
}
