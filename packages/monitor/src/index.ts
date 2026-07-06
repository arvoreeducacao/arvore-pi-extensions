import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
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

function formatEvent(event: MonitorEvent): string {
  const tag =
    event.kind === "exit"
      ? "🏁"
      : event.kind === "flood"
        ? "🚱"
        : event.kind === "stderr"
          ? "⚠️"
          : "📡";
  return `${tag} [monitor:${event.monitorId}] ${event.line}`;
}

export default function extension(pi: ExtensionAPI): void {
  const pushEvent = (event: MonitorEvent, deliverAs: "steer" | "followUp") => {
    pi.sendUserMessage(formatEvent(event), { deliverAs });
  };

  pi.registerTool({
    name: "monitor_start",
    label: "Start Monitor",
    description:
      "Watch a long-running background process and receive each matching output line as a push notification (no polling). Use for tailing deploy/CI/test logs, file watchers, or any process that emits progress over time. The command runs in a shell in the background and this tool returns immediately.",
    promptSnippet:
      "Start a background monitor that pushes matching stdout/stderr lines back to you as they happen",
    promptGuidelines: [
      "Use monitor_start when the user asks to watch/tail a long-running process (deploy, CI, tests, build, file changes) and react to its output without blocking the conversation.",
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
    }),
    async execute(_toolCallId, params) {
      const deliverAs = params.deliverAs ?? "steer";
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
          (event) => pushEvent(event, deliverAs),
        );
        return {
          content: [
            {
              type: "text",
              text: `Monitor "${handle.config.id}" started: \`${handle.config.command}\`. Matching lines will be pushed to you as they arrive (delivery: ${deliverAs}). Continue working; you'll be notified on new output.`,
            },
          ],
          details: { id: handle.config.id, command: handle.config.command, deliverAs } as Record<string, unknown>,
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
        const count = stopAllMonitors();
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
    description: "List running background monitors.",
    handler: async (_args, ctx) => {
      const running = listMonitors();
      if (running.length === 0) {
        ctx.ui.notify("No monitors running.", "info");
        return;
      }
      ctx.ui.notify(
        running.map((m) => `${m.id}: ${m.command} (${m.eventCount} events)`).join("\n"),
        "info",
      );
    },
  });

  pi.on("session_shutdown", async () => {
    stopAllMonitors();
  });
}
