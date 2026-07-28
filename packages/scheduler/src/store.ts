import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ScheduledTask, ScheduledTaskStore, SchedulerLock } from "./types.js";

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(value, null, 2));
  renameSync(tmpPath, filePath);
}

export class JsonScheduledTaskStore implements ScheduledTaskStore {
  private loaded = false;
  private readonly tasks = new Map<string, ScheduledTask>();
  private writeTail: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<ScheduledTask[]> {
    await this.load();
    return Array.from(this.tasks.values());
  }

  async get(taskId: string): Promise<ScheduledTask | undefined> {
    await this.load();
    return this.tasks.get(taskId);
  }

  async create(task: ScheduledTask): Promise<ScheduledTask> {
    await this.updateState(() => {
      this.tasks.set(task.id, task);
    });
    return task;
  }

  async update(taskId: string, task: ScheduledTask): Promise<ScheduledTask | undefined> {
    const updated = await this.updateState(() => {
      if (!this.tasks.has(taskId)) {
        return false;
      }
      this.tasks.set(taskId, task);
      return true;
    });
    return updated ? task : undefined;
  }

  async delete(taskId: string): Promise<boolean> {
    return await this.updateState(() => this.tasks.delete(taskId));
  }

  private async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    const tasks = await readJsonFile<ScheduledTask[]>(this.filePath, []);
    this.tasks.clear();
    for (const task of tasks) {
      this.tasks.set(task.id, task);
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await writeJsonFile(this.filePath, Array.from(this.tasks.values()));
  }

  private async updateState<T>(mutator: () => T): Promise<T> {
    const pending = this.writeTail.then(async () => {
      await this.load();
      const result = mutator();
      await this.save();
      return result;
    });
    this.writeTail = pending.catch(() => undefined);
    return await pending;
  }
}

export class FileSchedulerLock implements SchedulerLock {
  private acquired = false;

  constructor(readonly path: string) {}

  acquire(): boolean {
    mkdirSync(path.dirname(this.path), { recursive: true });
    const holder = this.holderPid();
    if (holder && holder !== process.pid) {
      return false;
    }
    try {
      unlinkSync(this.path);
    } catch {}
    try {
      writeFileSync(this.path, String(process.pid), { flag: "wx" });
      this.acquired = true;
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        this.acquired = false;
        return false;
      }
      throw error;
    }
  }

  release(): void {
    if (!this.acquired) {
      return;
    }
    try {
      const pid = Number(readFileSync(this.path, "utf8").trim());
      if (pid === process.pid) {
        unlinkSync(this.path);
      }
    } catch {}
    this.acquired = false;
  }

  isAcquired(): boolean {
    return this.acquired;
  }

  holderPid(): number | undefined {
    try {
      const pid = Number(readFileSync(this.path, "utf8").trim());
      if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) {
        return pid;
      }
      unlinkSync(this.path);
      return undefined;
    } catch {
      return undefined;
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
