export type ScheduledTaskType = "cron" | "once" | "interval";
export type ScheduledTaskStatus = "success" | "error" | "running";
export type ScheduledTaskDelivery = "new-session" | "origin-session";

export type ScheduledTaskRunHistoryEntry = {
  id: string;
  status: ScheduledTaskStatus | "paused" | "resumed";
  createdAt: string;
  sessionId?: string;
  message?: string;
};

export type ScheduledTaskRunContext = {
  historyEntryId: string;
  sessionId: string;
  startedAt: string;
};

export type ScheduledTask = {
  id: string;
  name?: string;
  prompt: string;
  type: ScheduledTaskType;
  schedule: string;
  intervalSeconds: number;
  enabled: boolean;
  delivery: ScheduledTaskDelivery;
  originSessionId?: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  timeoutMs?: number;
  lastStatus?: ScheduledTaskStatus;
  lastError?: string;
  runHistory?: ScheduledTaskRunHistoryEntry[];
};

export type ScheduledTaskCreateInput = Omit<
  ScheduledTask,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "nextRunAt"
  | "runCount"
  | "lastStatus"
  | "lastRunAt"
  | "lastError"
  | "runHistory"
>;

export type ScheduledTaskUpdate = Partial<
  Omit<
    ScheduledTask,
    | "id"
    | "createdAt"
    | "updatedAt"
    | "lastRunAt"
    | "lastError"
    | "nextRunAt"
    | "runCount"
    | "lastStatus"
    | "runHistory"
    | "name"
    | "originSessionId"
  >
> & {
  name?: string | undefined;
  originSessionId?: string | undefined;
};

export type TaskSchedulerStatus = {
  active: boolean;
  pid: number;
  taskCount: number;
  scheduledTimerCount: number;
  scheduledCronCount: number;
  runningTaskIds: string[];
  lock: {
    path: string;
    acquired: boolean;
    holderPid?: number;
  };
};

export interface TaskScheduler {
  list(): Promise<ScheduledTask[]>;
  get(taskId: string): Promise<ScheduledTask | undefined>;
  status(): Promise<TaskSchedulerStatus>;
  isActive(): boolean;
  create(input: ScheduledTaskCreateInput): Promise<ScheduledTask>;
  update(taskId: string, input: ScheduledTaskUpdate): Promise<ScheduledTask | undefined>;
  delete(taskId: string): Promise<boolean>;
  runNow(taskId: string): Promise<ScheduledTask | undefined>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ScheduledTaskStore {
  list(): Promise<ScheduledTask[]>;
  get(taskId: string): Promise<ScheduledTask | undefined>;
  create(task: ScheduledTask): Promise<ScheduledTask>;
  update(taskId: string, task: ScheduledTask): Promise<ScheduledTask | undefined>;
  delete(taskId: string): Promise<boolean>;
}

export interface SchedulerLock {
  readonly path: string;
  acquire(): boolean;
  release(): void;
  isAcquired(): boolean;
  holderPid(): number | undefined;
}

export type ScheduledTaskRunner = (
  task: ScheduledTask,
  run: ScheduledTaskRunContext,
) => Promise<void>;
