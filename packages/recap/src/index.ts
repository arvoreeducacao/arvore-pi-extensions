import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildTranscript, countUserTurns } from "./transcript.js";
import { summarizeRecap } from "./summarize.js";

const IDLE_THRESHOLD_MS = 3 * 60 * 1000;
const MIN_TURNS = 3;

function autoEnabled(): boolean {
  const raw = process.env.PI_ENABLE_AWAY_RECAP;
  if (raw === undefined) return true;
  return raw !== "0" && raw.toLowerCase() !== "false";
}

export default function recapExtension(pi: ExtensionAPI): void {
  let lastAgentEndAt = 0;
  let showedRecapSinceActivity = false;

  async function generateRecap(ctx: any): Promise<string | null> {
    const entries = ctx.sessionManager?.getBranch?.() ?? ctx.sessionManager?.getEntries?.() ?? [];
    if (countUserTurns(entries) < 1) return null;
    const transcript = buildTranscript(entries);
    if (!transcript.trim()) return null;
    return summarizeRecap(transcript, ctx);
  }

  pi.on("agent_end", async () => {
    lastAgentEndAt = Date.now();
    showedRecapSinceActivity = false;
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (!autoEnabled() || !ctx.hasUI) return;
    if (showedRecapSinceActivity) return;
    if (lastAgentEndAt === 0) return;

    const idleFor = Date.now() - lastAgentEndAt;
    if (idleFor < IDLE_THRESHOLD_MS) return;

    const entries = ctx.sessionManager?.getBranch?.() ?? ctx.sessionManager?.getEntries?.() ?? [];
    if (countUserTurns(entries) < MIN_TURNS) return;

    showedRecapSinceActivity = true;
    void (async () => {
      try {
        const recap = await generateRecap(ctx);
        if (recap) ctx.ui.notify(`Recap: ${recap}`, "info");
      } catch {
        // recap is best-effort; never block the turn
      }
    })();
  });

  pi.registerCommand("recap", {
    description: "Summarize where you left off in this session",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      await ctx.waitForIdle();

      ctx.ui.setWorkingMessage("Drafting recap...");
      try {
        const recap = await generateRecap(ctx);
        showedRecapSinceActivity = true;
        if (recap) {
          ctx.ui.notify(`Recap: ${recap}`, "info");
        } else {
          ctx.ui.notify("Not enough conversation to recap yet.", "warning");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Recap failed: ${msg}`, "error");
      } finally {
        ctx.ui.setWorkingMessage();
      }
    },
  });
}
