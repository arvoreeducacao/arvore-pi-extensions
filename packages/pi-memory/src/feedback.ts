import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sendFeedback } from "./api.js";
import type { SearchResult } from "./api.js";

const GRAYZONE_MIN = 0.45;
const GRAYZONE_MAX = 0.6;
const MIN_TURNS_BETWEEN_ASKS = 10;
const FEEDBACK_STATE_ENTRY = "memory-feedback-state";

interface FeedbackState {
  enabled: boolean;
  answered: Record<string, boolean>;
  lastAskedTurn: number;
}

const state: FeedbackState = {
  enabled: true,
  answered: {},
  lastAskedTurn: -Infinity,
};

let turnCounter = 0;

export function feedbackEnabled(): boolean {
  return state.enabled;
}

export function setFeedbackEnabled(value: boolean): void {
  state.enabled = value;
}

export function incrementTurn(): void {
  turnCounter++;
}

export function restoreFeedbackState(pi: ExtensionAPI, entries: unknown[]): void {
  for (const entry of entries) {
    const typed = entry as { type?: string; customType?: string; data?: Partial<FeedbackState> };
    if (typed.type === "custom" && typed.customType === FEEDBACK_STATE_ENTRY && typed.data) {
      if (typeof typed.data.enabled === "boolean") {
        state.enabled = typed.data.enabled;
      }
      if (typed.data.answered) {
        state.answered = { ...state.answered, ...typed.data.answered };
      }
    }
  }
}

function persist(pi: ExtensionAPI): void {
  pi.appendEntry(FEEDBACK_STATE_ENTRY, {
    enabled: state.enabled,
    answered: state.answered,
    lastAskedTurn: state.lastAskedTurn,
  });
}

function isPromising(result: SearchResult): boolean {
  return result.tier === "curated";
}

function pickCandidate(results: SearchResult[]): SearchResult | null {
  const eligible = results.filter(
    (r) =>
      r.score >= GRAYZONE_MIN &&
      r.score <= GRAYZONE_MAX &&
      isPromising(r) &&
      !(r.id in state.answered)
  );
  if (eligible.length === 0) {
    return null;
  }
  return eligible.sort((a, b) => b.score - a.score)[0];
}

export async function maybeAskFeedback(
  pi: ExtensionAPI,
  ctx: { ui: { confirm(title: string, message: string): Promise<boolean> } },
  results: SearchResult[]
): Promise<void> {
  if (!state.enabled) {
    return;
  }
  if (turnCounter - state.lastAskedTurn < MIN_TURNS_BETWEEN_ASKS) {
    return;
  }
  const candidate = pickCandidate(results);
  if (!candidate) {
    return;
  }

  state.lastAskedTurn = turnCounter;
  const preview = candidate.content.length > 200 ? `${candidate.content.slice(0, 200)}…` : candidate.content;
  const title = candidate.title ? `Memória: ${candidate.title}` : "Memória recuperada";

  let useful = false;
  try {
    useful = await ctx.ui.confirm(title, `Essa memória foi útil agora?\n\n${preview}`);
  } catch {
    return;
  }

  state.answered[candidate.id] = useful;
  persist(pi);

  try {
    await sendFeedback(candidate.id, useful);
  } catch {
    return;
  }
}
