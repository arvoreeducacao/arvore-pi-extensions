import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isOrcaSession } from "./core.js";
import { syncStatusFromTool, pushManualStatus, setStatusSyncEnabled, isStatusSyncEnabled } from "./status-sync.js";
import { registerTerminalTools } from "./terminal.js";
import { registerOrchestrationTools } from "./orchestration.js";
import { registerComputerTools } from "./computer.js";

const STATUS_SYNC_TOOLS = new Set(["todo", "create_goal", "update_goal"]);

export default function orcaBridgeExtension(pi: ExtensionAPI): void {
  let cwd = process.cwd();

  pi.on("session_start", async (_e, ctx) => {
    cwd = ctx.cwd || cwd;
  });

  pi.on("tool_execution_end", async (event) => {
    if (event.isError) return;
    if (!STATUS_SYNC_TOOLS.has(event.toolName)) return;
    try {
      syncStatusFromTool(event.toolName, event.result, cwd);
    } catch {
      // status sync is best-effort; never break the turn
    }
  });

  pi.registerTool({
    name: "orca_set_status",
    label: "Orca Set Status",
    description:
      "Manually set the Orca worktree card comment and (optionally) its board status. Use for milestones like moving a card to in-review. Status auto-syncs from todo/goal changes; use this for explicit control.",
    promptSnippet: "Set the Orca worktree card status/comment",
    parameters: Type.Object({
      comment: Type.String({ description: "Comment shown on the Orca card" }),
      status: Type.Optional(
        Type.Union(
          [Type.Literal("todo"), Type.Literal("in-progress"), Type.Literal("in-review"), Type.Literal("completed")],
          { description: "Board column id" },
        ),
      ),
    }),
    async execute(_id, params) {
      const r = pushManualStatus(cwd, params.comment, params.status);
      return { content: [{ type: "text", text: r.message }], details: { ok: r.ok } };
    },
  });

  pi.registerCommand("orca-status-sync", {
    description: "Toggle automatic Orca card status sync from todo/goal changes",
    async handler(ctx: any) {
      const args = (ctx.args || "").trim().toLowerCase();
      if (args === "on") setStatusSyncEnabled(true);
      else if (args === "off") setStatusSyncEnabled(false);
      else setStatusSyncEnabled(!isStatusSyncEnabled());
      const state = isStatusSyncEnabled() ? "ON" : "OFF";
      const note = isOrcaSession() ? "" : " (no-op: not in an Orca session)";
      ctx.ui?.notify?.(`Orca status sync: ${state}${note}`, "info");
    },
  });

  registerTerminalTools(pi);
  registerOrchestrationTools(pi);
  registerComputerTools(pi);
}
