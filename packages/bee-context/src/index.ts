import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

const FACTS_LIMIT = 100;
const FACTS_FETCH_TIMEOUT_MS = 8000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

interface BeeFact {
  id: number;
  text: string;
  tags?: string[];
  created_at?: number;
  confirmed?: boolean;
}

interface FactsState {
  facts: BeeFact[];
  fetchedAt: number;
  error?: string;
}

function parseFacts(stdout: string): BeeFact[] {
  const payload = JSON.parse(stdout) as { facts?: BeeFact[] };
  if (!payload || !Array.isArray(payload.facts)) return [];
  return payload.facts.filter(
    (fact): fact is BeeFact => Boolean(fact) && typeof fact.text === "string",
  );
}

async function fetchFacts(signal?: AbortSignal): Promise<FactsState> {
  try {
    const { stdout } = await execFileAsync(
      "bee",
      ["facts", "list", "--limit", String(FACTS_LIMIT), "--json"],
      { timeout: FACTS_FETCH_TIMEOUT_MS, signal, maxBuffer: MAX_OUTPUT_BYTES },
    );
    const facts = parseFacts(stdout).filter((fact) => fact.confirmed !== false);
    return { facts, fetchedAt: Date.now() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { facts: [], fetchedAt: Date.now(), error: message };
  }
}

function renderFactsBlock(facts: BeeFact[]): string {
  if (facts.length === 0) return "";

  const grouped = new Map<string, string[]>();
  for (const fact of facts) {
    const tag = fact.tags?.[0] ?? "general";
    const bucket = grouped.get(tag) ?? [];
    bucket.push(fact.text);
    grouped.set(tag, bucket);
  }

  const sections: string[] = [];
  for (const [tag, items] of [...grouped.entries()].sort()) {
    sections.push(`### ${tag}`);
    for (const item of items) sections.push(`- ${item}`);
  }

  return [
    "## User Personal Context (from Bee)",
    "The following are confirmed facts about the user gathered from their personal Bee assistant.",
    "Use them to personalize responses, anticipate needs, and adapt tone. Treat as sensitive: never echo verbatim unless relevant, never expose to third parties.",
    "",
    sections.join("\n"),
  ].join("\n");
}

export default function (pi: ExtensionAPI): void {
  let state: FactsState = { facts: [], fetchedAt: 0 };

  pi.on("session_start", async (_event, ctx) => {
    state = await fetchFacts(ctx.signal);
  });

  pi.on("before_agent_start", async (event) => {
    if (state.facts.length === 0) return;
    const block = renderFactsBlock(state.facts);
    if (!block) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
  });

  pi.registerCommand("bee-refresh", {
    description: "Re-fetch personal facts from Bee and update the injected context",
    handler: async (_args, ctx) => {
      state = await fetchFacts(ctx.signal);
      if (state.error) {
        ctx.ui.notify(`Bee facts refresh failed: ${state.error}`, "error");
        return;
      }
      ctx.ui.notify(`Bee facts refreshed (${state.facts.length} confirmed).`, "info");
    },
  });

  pi.registerCommand("bee-show", {
    description: "Show the personal facts currently injected from Bee",
    handler: async (_args, ctx) => {
      if (state.facts.length === 0) {
        ctx.ui.notify(
          state.error ? `No Bee facts (last error: ${state.error})` : "No Bee facts loaded.",
          state.error ? "error" : "info",
        );
        return;
      }
      ctx.ui.notify(renderFactsBlock(state.facts), "info");
    },
  });
}
