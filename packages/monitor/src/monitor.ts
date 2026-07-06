import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

export type StreamKind = "stdout" | "stderr";

export interface MonitorConfig {
  id: string;
  command: string;
  cwd?: string;
  include?: RegExp;
  exclude?: RegExp;
  captureStderr: boolean;
  reportExit: boolean;
  maxEventsPerWindow: number;
  windowMs: number;
}

export interface MonitorEvent {
  monitorId: string;
  command: string;
  kind: StreamKind | "exit" | "flood";
  line: string;
}

export interface MonitorHandle {
  config: MonitorConfig;
  startedAt: number;
  eventCount: number;
  stop(reason: string): void;
}

type Emit = (event: MonitorEvent) => void;

interface RunningMonitor extends MonitorHandle {
  child: ChildProcessWithoutNullStreams;
  stdoutReader: Interface;
  stderrReader?: Interface;
  windowStart: number;
  windowCount: number;
  stopped: boolean;
}

const monitors = new Map<string, RunningMonitor>();

function matches(line: string, include?: RegExp, exclude?: RegExp): boolean {
  if (exclude && exclude.test(line)) return false;
  if (include) return include.test(line);
  return true;
}

export function startMonitor(config: MonitorConfig, emit: Emit): MonitorHandle {
  if (monitors.has(config.id)) {
    throw new Error(`A monitor with id "${config.id}" is already running.`);
  }

  const child = spawn(config.command, {
    cwd: config.cwd,
    shell: true,
    env: process.env,
    detached: process.platform !== "win32",
  }) as ChildProcessWithoutNullStreams;

  const maxEventsPerWindow =
    config.maxEventsPerWindow > 0 ? config.maxEventsPerWindow : 1;

  const handle: RunningMonitor = {
    config,
    startedAt: Date.now(),
    eventCount: 0,
    child,
    stdoutReader: createInterface({ input: child.stdout }),
    windowStart: Date.now(),
    windowCount: 0,
    stopped: false,
    stop(reason: string) {
      stopMonitor(config.id, reason);
    },
  };

  const onLine = (kind: StreamKind) => (raw: string) => {
    if (handle.stopped) return;
    const line = raw.trimEnd();
    if (!line) return;
    if (!matches(line, config.include, config.exclude)) return;

    const now = Date.now();
    if (now - handle.windowStart > config.windowMs) {
      handle.windowStart = now;
      handle.windowCount = 0;
    }
    handle.windowCount += 1;

    if (handle.windowCount > maxEventsPerWindow) {
      emit({
        monitorId: config.id,
        command: config.command,
        kind: "flood",
        line: `Monitor "${config.id}" exceeded ${maxEventsPerWindow} events in ${Math.round(config.windowMs / 1000)}s and was auto-stopped. Restart it with a tighter include/exclude filter.`,
      });
      stopMonitor(config.id, "flood");
      return;
    }

    handle.eventCount += 1;
    emit({ monitorId: config.id, command: config.command, kind, line });
  };

  handle.stdoutReader.on("line", onLine("stdout"));

  if (config.captureStderr) {
    handle.stderrReader = createInterface({ input: child.stderr });
    handle.stderrReader.on("line", onLine("stderr"));
  } else {
    child.stderr.resume();
  }

  child.on("exit", (code, signal) => {
    if (handle.stopped) return;
    handle.stopped = true;
    handle.stdoutReader.close();
    handle.stderrReader?.close();
    monitors.delete(config.id);
    if (config.reportExit) {
      const status = signal ? `killed by signal ${signal}` : `exit code ${code}`;
      emit({
        monitorId: config.id,
        command: config.command,
        kind: "exit",
        line: `Process finished (${status}).`,
      });
    }
  });

  child.on("error", (err) => {
    if (handle.stopped) return;
    handle.stopped = true;
    handle.stdoutReader.close();
    handle.stderrReader?.close();
    monitors.delete(config.id);
    emit({
      monitorId: config.id,
      command: config.command,
      kind: "exit",
      line: `Process failed to start: ${err.message}`,
    });
  });

  monitors.set(config.id, handle);
  return handle;
}

export function stopMonitor(id: string, _reason: string): boolean {
  const handle = monitors.get(id);
  if (!handle) return false;
  handle.stopped = true;
  handle.stdoutReader.close();
  handle.stderrReader?.close();
  killProcessTree(handle.child);
  monitors.delete(id);
  return true;
}

function killProcessTree(child: ChildProcessWithoutNullStreams): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    if (process.platform !== "win32") {
      process.kill(-pid, "SIGTERM");
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // process already gone
    }
  }
}

export function listMonitors(): Array<{
  id: string;
  command: string;
  uptimeMs: number;
  eventCount: number;
}> {
  return [...monitors.values()].map((m) => ({
    id: m.config.id,
    command: m.config.command,
    uptimeMs: Date.now() - m.startedAt,
    eventCount: m.eventCount,
  }));
}

export function stopAllMonitors(): number {
  const ids = [...monitors.keys()];
  for (const id of ids) stopMonitor(id, "shutdown");
  return ids.length;
}

export function safeRegExp(source: string | undefined, flags = "i"): RegExp | undefined {
  if (!source) return undefined;
  return new RegExp(source, flags);
}
