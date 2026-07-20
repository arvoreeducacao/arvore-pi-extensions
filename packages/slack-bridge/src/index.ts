import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SlackBridgeConfig } from "./config.js";
import { loadConfig } from "./config.js";
import type { SlackBridge } from "./bridge.js";

type Bridge = Pick<
  SlackBridge,
  | "bindContext"
  | "restoreFromEntries"
  | "start"
  | "stop"
  | "mirrorUserInput"
  | "beginTurn"
  | "recordTool"
  | "recordToolResult"
  | "recordAssistantMessage"
  | "finishTurn"
  | "handlePromptEvent"
>;
type SlackBridgeConstructor = new (pi: ExtensionAPI, config: SlackBridgeConfig) => Bridge;
type BridgeModule = { SlackBridge: SlackBridgeConstructor };
export type BridgeLoader = () => Promise<BridgeModule>;

const defaultBridgeLoader: BridgeLoader = () => import("./bridge.js");

export default function (pi: ExtensionAPI, bridgeLoader: BridgeLoader = defaultBridgeLoader): void {
  const { config, missing } = loadConfig();

  let bridge: Bridge | undefined;
  let bridgeModulePromise: Promise<BridgeModule> | undefined;
  let lastContext: ExtensionContext | undefined;
  let starting: Promise<void> | undefined;

  function captureContext(ctx: ExtensionContext): void {
    lastContext = ctx;
  }

  function setIndicator(on: boolean): void {
    lastContext?.ui.setStatus("slack-bridge", on ? "\ud83d\udfe2 Slack" : undefined);
  }

  async function loadBridgeModule(): Promise<BridgeModule> {
    if (!bridgeModulePromise) {
      bridgeModulePromise = bridgeLoader().catch((error) => {
        bridgeModulePromise = undefined;
        throw error;
      });
    }
    return bridgeModulePromise;
  }

  async function startBridge(ctx: ExtensionContext): Promise<void> {
    if (!config) return;
    captureContext(ctx);
    if (starting) return starting;
    if (bridge) return;
    starting = loadBridgeModule()
      .then(({ SlackBridge }) => {
        const instance = new SlackBridge(pi, config);
        instance.bindContext(() => lastContext);
        instance.restoreFromEntries(ctx);
        bridge = instance;
        return instance.start();
      })
      .then(() => {
        setIndicator(true);
        ctx.ui.notify("Slack bridge conectada para esta sessão.", "info");
      })
      .catch((error) => {
        ctx.ui.notify(`Slack bridge falhou ao conectar: ${(error as Error).message}`, "error");
        bridge = undefined;
      })
      .finally(() => {
        starting = undefined;
      });
    return starting;
  }

  async function stopBridge(): Promise<void> {
    await starting?.catch(() => {});
    await bridge?.stop().catch(() => {});
    bridge = undefined;
    setIndicator(false);
  }

  pi.on("input", async (event, ctx) => {
    captureContext(ctx);
    if (!bridge) return;
    if (event.source === "extension") return;
    await bridge.mirrorUserInput(event.text).catch(() => {});
  });

  pi.on("turn_start", async (_event, ctx) => {
    captureContext(ctx);
    if (!bridge) return;
    await bridge.beginTurn().catch(() => {});
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    captureContext(ctx);
    if (!bridge) return;
    await bridge.recordTool(event.toolCallId, event.toolName, event.args).catch(() => {});
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    captureContext(ctx);
    if (!bridge) return;
    await bridge.recordToolResult(event.toolCallId, event.result, event.isError).catch(() => {});
  });

  pi.on("message_end", async (event, ctx) => {
    captureContext(ctx);
    if (!bridge) return;
    await bridge.recordAssistantMessage(event.message).catch(() => {});
  });

  pi.on("turn_end", async (event, ctx) => {
    captureContext(ctx);
    if (!bridge) return;
    await bridge.finishTurn(event.message).catch(() => {});
  });

  pi.events.on("arvore:ask-user:prompt", (payload) => {
    if (!bridge) return;
    void bridge.handlePromptEvent(payload).catch(() => {});
  });

  pi.on("session_shutdown", async () => {
    await stopBridge();
  });

  pi.registerCommand("slack-bridge", {
    description: "Liga/desliga a ponte Pi <-> Slack nesta sessão (on | off | status)",
    handler: async (args, ctx) => {
      captureContext(ctx);
      if (missing.length > 0) {
        ctx.ui.notify(`Slack bridge indisponível. Defina: ${missing.join(", ")}`, "warning");
        return;
      }
      const action = args.trim().toLowerCase();
      if (action === "off" || action === "stop") {
        if (!bridge && !starting) {
          ctx.ui.notify("Slack bridge já está desligada.", "info");
          return;
        }
        await stopBridge();
        ctx.ui.notify("Slack bridge desligada nesta sessão.", "info");
        return;
      }
      if (action === "status") {
        ctx.ui.notify(
          bridge ? "Slack bridge ativa nesta sessão." : "Slack bridge desligada. Use /slack-bridge on.",
          bridge ? "info" : "warning",
        );
        return;
      }
      if (bridge) {
        ctx.ui.notify("Slack bridge já está ativa nesta sessão.", "info");
        return;
      }
      await startBridge(ctx);
    },
  });
}
