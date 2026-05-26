import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";

interface TabTitleState {
  emoji: string;
  summary: string;
}

const STATE_TYPE = "warp-tab-title";
const DEFAULT_EMOJI = "🤖";
const MAX_SUMMARY_LEN = 60;

let pi: ExtensionAPI;
let currentState: TabTitleState | null = null;

function basenameCwd(): string {
  return path.basename(process.cwd()) || "pi";
}

function buildTitle(state: TabTitleState | null): string {
  if (state) {
    const emoji = state.emoji.trim() || DEFAULT_EMOJI;
    const summary = state.summary.trim().slice(0, MAX_SUMMARY_LEN);
    return summary ? `${emoji} ${summary}` : `${emoji} ${basenameCwd()}`;
  }
  const sessionName = pi?.getSessionName?.();
  const cwd = basenameCwd();
  return sessionName
    ? `${DEFAULT_EMOJI} ${sessionName} · ${cwd}`
    : `${DEFAULT_EMOJI} ${cwd}`;
}

function restoreFromBranch(ctx: ExtensionContext): void {
  const entries = ctx.sessionManager.getBranch();
  let last: TabTitleState | null = null;
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === STATE_TYPE) {
      const data = entry.data as TabTitleState | undefined;
      if (data?.summary) last = data;
    }
  }
  currentState = last;
}

function applyTitle(ctx: ExtensionContext): void {
  ctx.ui.setTitle(buildTitle(currentState));
}

const SYSTEM_PROMPT_INSTRUCTION = `
<warp_tab_title>
You can rename the user's terminal tab to reflect what you are currently working on by calling the \`set_tab_title\` tool.

When to call it:
- At the start of a new task or thread, once you understand the user's goal
- Whenever the focus shifts to a meaningfully different task (different repo, different feature, different bug, different phase like refinement → coding → review)

When NOT to call it:
- For trivial follow-ups inside the same task
- For each tool call or each message
- More than once per ~5 turns unless the focus genuinely changed

Style:
- Pick an emoji that fits the activity (🐛 debug, 📝 refinement, 🚀 deploy, 🔍 investigate, ✨ feature, 🧪 test, 📚 docs, 🔧 fix, 🎨 ui, 🧹 refactor, 🤖 generic)
- Summary should be short (≤ 6 words), action-oriented, in the user's working language
- Examples: "Refinement EXP-231", "Debug memory leak api-arvore", "Refactor auth flow", "Deploy criar staging"
</warp_tab_title>
`.trim();

export default function warpTabTitleExtension(api: ExtensionAPI): void {
  pi = api;

  pi.registerTool({
    name: "set_tab_title",
    label: "Tab Title",
    description:
      "Rename the user's terminal tab (Warp) to reflect the current task. Call this when starting a new task or when the focus changes meaningfully.",
    promptSnippet: "Rename the Warp tab to reflect the current task focus.",
    promptGuidelines: [
      "Use set_tab_title at the start of a new thread and whenever the focus shifts to a different task, repo, or phase.",
      "Pick a fitting emoji and a short action-oriented summary (≤ 6 words).",
      "Do not call it on every turn — only when the context genuinely changed.",
    ],
    parameters: Type.Object({
      emoji: Type.String({
        description:
          "A single emoji that represents the activity (e.g., 🐛, 📝, 🚀, 🔍, ✨, 🧪, 🔧, 🎨, 🧹).",
      }),
      summary: Type.String({
        description:
          "Short action-oriented summary of the current task (≤ 6 words). Use the user's working language.",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const next: TabTitleState = {
        emoji: params.emoji?.trim() || DEFAULT_EMOJI,
        summary: params.summary?.trim() || "",
      };
      if (!next.summary) {
        throw new Error("summary cannot be empty");
      }
      currentState = next;
      pi.appendEntry<TabTitleState>(STATE_TYPE, next);
      applyTitle(ctx);
      return {
        content: [
          {
            type: "text",
            text: `Tab renamed to: ${buildTitle(next)}`,
          },
        ],
        details: next,
      };
    },
    renderResult(result, _options, theme, _context) {
      const data = result.details as TabTitleState | undefined;
      if (!data) return new Text(theme.fg("dim", "tab title set"), 0, 0);
      return new Text(
        theme.fg("dim", "tab → ") +
          theme.fg("accent", `${data.emoji} ${data.summary}`),
        0,
        0,
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    restoreFromBranch(ctx);
    applyTitle(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    restoreFromBranch(ctx);
    applyTitle(ctx);
  });

  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt: `${event.systemPrompt}\n\n${SYSTEM_PROMPT_INSTRUCTION}`,
    };
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setTitle(`${DEFAULT_EMOJI} ${basenameCwd()}`);
  });
}
