import { randomUUID } from "node:crypto";
import { closeSync, openSync, writeSync } from "node:fs";
import path from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@earendil-works/pi-ai";

interface TabTitleState {
	emoji: string;
	summary: string;
}

const STATE_TYPE = "warp-tab-title";
const DEFAULT_EMOJI = "🤖";
const MAX_SUMMARY_LEN = 60;

function basenameCwd(): string {
	return path.basename(process.cwd()) || "pi";
}

function buildTitle(state: TabTitleState | null): string {
	if (state) {
		const emoji = state.emoji.trim() || DEFAULT_EMOJI;
		const summary = state.summary.trim().slice(0, MAX_SUMMARY_LEN);
		return summary ? `${emoji} ${summary}` : `${emoji} ${basenameCwd()}`;
	}
	const sessionName = pi.getSessionName?.();
	const cwd = basenameCwd();
	return sessionName ? `${DEFAULT_EMOJI} ${sessionName} · ${cwd}` : `${DEFAULT_EMOJI} ${cwd}`;
}

let pi: ExtensionAPI;
let currentState: TabTitleState | null = null;

const WARP_AGENT_NAME = "pi";
const WARP_PROTOCOL_VERSION = 1;
const warpSessionId = randomUUID();
let lastQuery = "";

function isWarpTerminal(): boolean {
	return process.env.TERM_PROGRAM === "WarpTerminal";
}

function emitWarpSequence(seq: string) {
	if (!isWarpTerminal()) return;
	try {
		const fd = openSync("/dev/tty", "w");
		try {
			writeSync(fd, seq);
		} finally {
			closeSync(fd);
		}
	} catch {
		try {
			process.stdout.write(seq);
		} catch {}
	}
}

function sendWarpEvent(event: string, extra: Record<string, unknown> = {}) {
	if (!isWarpTerminal()) return;
	const cwd = process.cwd();
	const payload = {
		v: WARP_PROTOCOL_VERSION,
		agent: WARP_AGENT_NAME,
		event,
		session_id: warpSessionId,
		cwd,
		project: path.basename(cwd) || "pi",
		...extra,
	};
	const body = JSON.stringify(payload);
	const seq = `\x1b]777;notify;warp://cli-agent;${body}\x07`;
	emitWarpSequence(seq);
}

function truncate(text: string, max = 200): string {
	if (!text) return "";
	return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function restoreFromBranch(ctx: ExtensionContext) {
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

function applyTitle(ctx: ExtensionContext) {
	ctx.ui.setTitle(buildTitle(currentState));
}

export default function (api: ExtensionAPI) {
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
		sendWarpEvent("session_start");
	});

	pi.on("input", async (event) => {
		if (event.source !== "interactive" && event.source !== "rpc") return;
		const text = (event.text ?? "").trim();
		if (!text) return;
		lastQuery = truncate(text);
		sendWarpEvent("prompt_submit", { query: lastQuery });
	});

	pi.on("agent_start", async () => {
		sendWarpEvent("prompt_submit", { query: lastQuery });
	});

	pi.on("agent_end", async (event) => {
		let response = "";
		for (const message of event.messages ?? []) {
			if (message.role !== "assistant") continue;
			for (const block of message.content ?? []) {
				if (block.type === "text" && block.text) {
					response = block.text;
				}
			}
		}
		sendWarpEvent("stop", {
			query: lastQuery,
			response: truncate(response),
		});
	});

	pi.on("tool_execution_end", async (event) => {
		sendWarpEvent("post_tool_use", {
			tool_name: event.toolName,
			is_error: event.isError ?? false,
		});
	});

	pi.on("session_tree", async (_event, ctx) => {
		restoreFromBranch(ctx);
		applyTitle(ctx);
	});

	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt: event.systemPrompt,
		};
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setTitle(`${DEFAULT_EMOJI} ${basenameCwd()}`);
		sendWarpEvent("stop", { query: lastQuery, response: "" });
	});
}
