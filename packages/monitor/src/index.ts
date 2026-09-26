import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { Container, Text } from "@earendil-works/pi-tui";
import {
  listMonitors,
  safeRegExp,
  startMonitor,
  stopAllMonitors,
  stopMonitor,
  type MonitorEvent,
} from "./monitor.js";

const DEFAULT_MAX_EVENTS = 40;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_COALESCE_MS = 500;
const MAX_BATCH_LINES = 20;
const STATUS_KEY = "monitor";
const MAX_LOG_LINES = 200;

type DeliverAs = "steer" | "followUp";

interface PendingBatch {
  events: MonitorEvent[];
  timer?: ReturnType<typeof setTimeout>;
}

type UIRef = {
  setStatus: (key: string, text: string | undefined) => void;
};

function kindTag(kind: MonitorEvent["kind"]): string {
  switch (kind) {
    case "exit":
      return "exit";
    case "flood":
      return "flood";
    case "stderr":
      return "err";
    default:
      return "out";
  }
}

function formatEvent(event: MonitorEvent): string {
  return `[monitor:${event.monitorId}] (${kindTag(event.kind)}) ${event.line}`;
}

function formatBatch(events: MonitorEvent[]): string {
  if (events.length === 1) return formatEvent(events[0]);
  const mixedKinds = new Set(events.map((e) => e.kind)).size > 1;
  const header = mixedKinds
    ? `[monitor:${events[0].monitorId}] (${events.length} lines)`
    : `[monitor:${events[0].monitorId}] (${kindTag(events[0].kind)} ×${events.length})`;
  const body = events.map(
    (e) => `  ${mixedKinds ? `(${kindTag(e.kind)}) ` : ""}${e.line}`,
  );
  return [header, ...body].join("\n");
}

export default function extension(pi: ExtensionAPI): void {
  let ui: UIRef | undefined;
  const logBuffer: MonitorEvent[] = [];

  const refreshStatus = () => {
    if (!ui) return;
    const active = listMonitors().length;
    if (active === 0) {
      ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    const label = active === 1 ? "1 monitor ativo" : `${active} monitores ativos`;
    ui.setStatus(STATUS_KEY, `${label} · /monitors p/ logs`);
  };

  const recordEvent = (event: MonitorEvent) => {
    logBuffer.push(event);
    while (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
    refreshStatus();
  };

  // Lines are coalesced per monitor so a burst costs one turn instead of one turn per line.
  const delivery = new Map<string, { deliverAs: DeliverAs; coalesceMs: number }>();
  const pending = new Map<string, PendingBatch>();

  const flushPending = (monitorId: string) => {
    const batch = pending.get(monitorId);
    if (!batch) return;
    pending.delete(monitorId);
    if (batch.timer) clearTimeout(batch.timer);
    if (batch.events.length === 0) return;
    pi.sendUserMessage(formatBatch(batch.events), {
      deliverAs: delivery.get(monitorId)?.deliverAs ?? "steer",
    });
  };

  const pushEvent = (event: MonitorEvent) => {
    recordEvent(event);
    const settings = delivery.get(event.monitorId) ?? {
      deliverAs: "steer" as DeliverAs,
      coalesceMs: DEFAULT_COALESCE_MS,
    };
    const terminal = event.kind === "exit" || event.kind === "flood";

    // Terminal events go out immediately, after flushing whatever they were queued behind.
    if (terminal || settings.coalesceMs <= 0) {
      flushPending(event.monitorId);
      pi.sendUserMessage(formatEvent(event), { deliverAs: settings.deliverAs });
      if (terminal) delivery.delete(event.monitorId);
      return;
    }

    const batch: PendingBatch = pending.get(event.monitorId) ?? { events: [] };
    batch.events.push(event);
    pending.set(event.monitorId, batch);

    if (batch.events.length >= MAX_BATCH_LINES) {
      flushPending(event.monitorId);
      return;
    }

    if (!batch.timer) {
      batch.timer = setTimeout(() => flushPending(event.monitorId), settings.coalesceMs);
    }
  };

  const captureUI = (ctx: { ui?: UIRef }) => {
    if (ctx.ui) ui = ctx.ui;
  };

  const openLogPanel = async (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("O painel de logs precisa do modo TUI.", "error");
      return;
    }
    const running = listMonitors();
    if (running.length === 0 && logBuffer.length === 0) {
      ctx.ui.notify("Nenhum monitor ativo e nenhum log recente.", "info");
      return;
    }

    await ctx.ui.custom<void>((tui, theme, _kb, done) => {
      const container = new Container();
      const activeLabel =
        running.length === 0
          ? "sem monitores ativos"
          : running.map((m) => m.id).join(", ");
      container.addChild(
        new Text(
          `${theme.fg("accent", theme.bold("monitor logs"))}  ${theme.fg("muted", `${activeLabel} · esc fecha`)}`,
          1,
          1,
        ),
      );
      const recent = logBuffer.slice(-40);
      if (recent.length === 0) {
        container.addChild(new Text(theme.fg("muted", "  (sem eventos ainda)"), 0, 1));
      }
      for (const e of recent) {
        const prefix = theme.fg("muted", `[${e.monitorId}] `);
        const body = e.line;
        let line: string;
        if (e.kind === "stderr" || e.kind === "flood") {
          line = prefix + theme.fg("warning", body);
        } else if (e.kind === "exit") {
          line = prefix + theme.fg("success", body);
        } else {
          line = prefix + body;
        }
        container.addChild(new Text(line, 0, 0));
      }

      return {
        render: (width: number) => container.render(width),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => {
          if (data === "\x1b" || data === "q") {
            done(undefined);
            return;
          }
          tui.requestRender();
        },
      };
    }, { overlay: true });
  };

  pi.on("session_start", async (_event, ctx) => {
    captureUI(ctx as unknown as { ui?: UIRef });
    refreshStatus();
  });

  pi.on("session_tree", async (_event, ctx) => {
    captureUI(ctx as unknown as { ui?: UIRef });
    refreshStatus();
  });

  pi.registerTool({
    name: "monitor_start",
    label: "Start Monitor",
    description:
      "Watch a long-running background process and receive each matching output line as a push notification (no polling). Use for tailing deploy/CI/test logs, file watchers, or any process that emits progress over time. The command runs in a shell in the background and this tool returns immediately.",
    promptSnippet:
      "Start a background monitor that pushes matching stdout/stderr lines back to you as they happen",
    promptGuidelines: [
      "Use monitor_start when the user asks to watch/tail a long-running process (deploy, CI, tests, build, file changes) and react to its output without blocking the conversation.",
      "Matching lines are coalesced into one notification per quiet window (coalesceMs, default 500ms), so a burst costs a single turn; use coalesceMs: 0 only when every line must arrive the moment it appears.",
      "Always set an include or exclude regex on monitor_start for verbose processes — an unfiltered monitor of a chatty process will be auto-stopped for flooding.",
      "Set reportExit=true on monitor_start when you need to know if the process fails silently; monitor also forwards stderr by default.",
      "Stop a monitor with monitor_stop once its purpose is served; monitors are session-scoped and die on shutdown.",
    ],
    parameters: Type.Object({
      id: Type.String({
        description: "Short unique name for this monitor (e.g. 'deploy', 'ci', 'tests').",
      }),
      command: Type.String({
        description: "Shell command to run in the background (e.g. 'docker compose up --build').",
      }),
      cwd: Type.Optional(
        Type.String({ description: "Working directory for the command. Defaults to session cwd." }),
      ),
      include: Type.Optional(
        Type.String({
          description:
            "Case-insensitive regex; only lines matching it are pushed. Omit to push all lines.",
        }),
      ),
      exclude: Type.Optional(
        Type.String({
          description: "Case-insensitive regex; lines matching it are dropped. Applied before include.",
        }),
      ),
      captureStderr: Type.Optional(
        Type.Boolean({ description: "Forward stderr lines too. Default true." }),
      ),
      reportExit: Type.Optional(
        Type.Boolean({ description: "Notify when the process exits (with its code). Default true." }),
      ),
      deliverAs: Type.Optional(
        Type.Union([Type.Literal("steer"), Type.Literal("followUp")], {
          description:
            "'steer' (default) reacts mid-conversation; 'followUp' waits until you finish the current turn.",
        }),
      ),
      maxEventsPerWindow: Type.Optional(
        Type.Number({
          description: `Auto-stop the monitor if it emits more than this many matching lines per window. Default ${DEFAULT_MAX_EVENTS}.`,
        }),
      ),
      coalesceMs: Type.Optional(
        Type.Number({
          description: `Batch matching lines that arrive within this many milliseconds into a single notification. 0 pushes every line immediately. Default ${DEFAULT_COALESCE_MS}.`,
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      captureUI(ctx as unknown as { ui?: UIRef });
      const deliverAs: DeliverAs = params.deliverAs ?? "steer";
      const coalesceMs = Math.max(0, params.coalesceMs ?? DEFAULT_COALESCE_MS);
      try {
        const handle = startMonitor(
          {
            id: params.id,
            command: params.command,
            cwd: params.cwd,
            include: safeRegExp(params.include),
            exclude: safeRegExp(params.exclude),
            captureStderr: params.captureStderr ?? true,
            reportExit: params.reportExit ?? true,
            maxEventsPerWindow: params.maxEventsPerWindow ?? DEFAULT_MAX_EVENTS,
            windowMs: DEFAULT_WINDOW_MS,
          },
          (event) => pushEvent(event),
        );
        delivery.set(params.id, { deliverAs, coalesceMs });
        const deliveryNote =
          coalesceMs > 0
            ? `Matching lines are coalesced into one notification per ${coalesceMs}ms quiet window (delivery: ${deliverAs}).`
            : `Every matching line is pushed as it arrives (delivery: ${deliverAs}).`;
        refreshStatus();
        return {
          content: [
            {
              type: "text",
              text: `Monitor "${handle.config.id}" started: \`${handle.config.command}\`. ${deliveryNote} Continue working; you'll be notified on new output.`,
            },
          ],
          details: {
            id: handle.config.id,
            command: handle.config.command,
            deliverAs,
            coalesceMs,
          } as Record<string, unknown>,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Failed to start monitor: ${message}` }],
          details: { error: message } as Record<string, unknown>,
        };
      }
    },
  });

  pi.registerTool({
    name: "monitor_stop",
    label: "Stop Monitor",
    description: "Stop a running background monitor by id, or all monitors.",
    parameters: Type.Object({
      id: Type.Optional(
        Type.String({ description: "Monitor id to stop. Omit and pass all=true to stop everything." }),
      ),
      all: Type.Optional(Type.Boolean({ description: "Stop every running monitor." })),
    }),
    async execute(_toolCallId, params) {
      if (params.all) {
        const ids = listMonitors().map((m) => m.id);
        const count = stopAllMonitors();
        for (const id of ids) {
          flushPending(id);
          delivery.delete(id);
        }
        refreshStatus();
        return {
          content: [{ type: "text", text: `Stopped ${count} monitor(s).` }],
          details: { stopped: count } as Record<string, unknown>,
        };
      }
      if (!params.id) {
        return {
          content: [{ type: "text", text: "Provide a monitor id or set all=true." }],
          details: { error: "missing-id" } as Record<string, unknown>,
        };
      }
      const ok = stopMonitor(params.id, "manual");
      // The process is gone, so flushing now cannot race new output.
      if (ok) flushPending(params.id);
      delivery.delete(params.id);
      refreshStatus();
      return {
        content: [
          { type: "text", text: ok ? `Stopped monitor "${params.id}".` : `No monitor "${params.id}" running.` },
        ],
        details: { stopped: ok } as Record<string, unknown>,
      };
    },
  });

  pi.registerTool({
    name: "monitor_list",
    label: "List Monitors",
    description: "List currently running background monitors with uptime and event counts.",
    parameters: Type.Object({}),
    async execute() {
      const running = listMonitors();
      if (running.length === 0) {
        return { content: [{ type: "text", text: "No monitors running." }], details: { monitors: [] } };
      }
      const text = running
        .map(
          (m) =>
            `• ${m.id}: \`${m.command}\` — up ${Math.round(m.uptimeMs / 1000)}s, ${m.eventCount} event(s) pushed`,
        )
        .join("\n");
      return { content: [{ type: "text", text }], details: { monitors: running } };
    },
  });

  pi.registerCommand("monitors", {
    description: "Open the monitor log panel (running monitors + recent events). Esc to close.",
    handler: async (_args, ctx) => {
      captureUI(ctx as unknown as { ui?: UIRef });
      await openLogPanel(ctx);
    },
  });

  pi.on("session_shutdown", async () => {
    for (const batch of pending.values()) {
      if (batch.timer) clearTimeout(batch.timer);
    }
    // Never push buffered lines into a session that is going away.
    pending.clear();
    delivery.clear();
    stopAllMonitors();
    logBuffer.length = 0;
    ui?.setStatus(STATUS_KEY, undefined);
  });
}
