import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { LspManager } from "./manager.js";
import { LANGUAGE_SERVERS } from "./registry.js";
import { registerLspTools } from "./tools.js";

export default function (pi: ExtensionAPI) {
  let manager: LspManager | null = null;

  const getManager = (): LspManager => {
    if (!manager) throw new Error("LSP manager not initialized; session not started yet.");
    return manager;
  };

  pi.on("session_start", async (_event, ctx) => {
    if (manager) return;
    manager = new LspManager(ctx.cwd, (message, level) => ctx.ui.notify(message, level ?? "info"));
  });

  pi.on("session_shutdown", async () => {
    await manager?.disposeAll();
    manager = null;
  });

  pi.registerCommand("lsp-status", {
    description: "Show configured LSP language servers and their availability.",
    handler: async (_args, ctx) => {
      const lines = LANGUAGE_SERVERS.map(
        (s) => `${s.label}: ${s.command} ${s.args.join(" ")} (${s.extensions.join(", ")})`,
      );
      ctx.ui.notify(`Configured LSP servers:\n${lines.join("\n")}`, "info");
    },
  });

  registerLspTools(pi, getManager);
}
