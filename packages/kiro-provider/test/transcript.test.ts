import type { Context, Message, Tool } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { resolveTranscript } from "../src/transcript.js";

const ts = Date.now();

function tool(name: string, description = `${name} tool`): Tool {
	return {
		name,
		description,
		parameters: { type: "object", properties: {} },
	} as unknown as Tool;
}

function transcriptContext(messages: Array<Record<string, unknown>>): Context {
	return { messages: messages as unknown as Message[] };
}

describe("resolveTranscript", () => {
	it("uses context.systemPrompt and context.tools when there are no system messages", () => {
		const read = tool("read");
		const context: Context = {
			systemPrompt: "You are helpful",
			tools: [read],
			messages: [{ role: "user", content: "Hi", timestamp: ts }],
		};
		const resolved = resolveTranscript(context);
		expect(resolved.systemPrompt).toBe("You are helpful");
		expect(resolved.tools).toEqual([read]);
		expect(resolved.messages).toBe(context.messages);
	});

	it("reads the prompt and tools from a leading system message", () => {
		const read = tool("read");
		const resolved = resolveTranscript(
			transcriptContext([
				{ role: "system", content: "You are helpful", toolsAdded: [read], timestamp: 0 },
				{ role: "user", content: "Hi", timestamp: ts },
			]),
		);
		expect(resolved.systemPrompt).toBe("You are helpful");
		expect(resolved.tools).toEqual([read]);
		expect(resolved.messages).toEqual([{ role: "user", content: "Hi", timestamp: ts }]);
	});

	it("replays later system messages: appended content, patched sections and tool changes", () => {
		const read = tool("read");
		const bash = tool("bash");
		const readV2 = tool("read", "read v2");
		const resolved = resolveTranscript(
			transcriptContext([
				{
					role: "system",
					content: [{ type: "text", text: "Base prompt" }],
					sections: { env: "<env>mac</env>", skills: "<skills>a</skills>" },
					toolsAdded: [read, bash],
					timestamp: 0,
				},
				{ role: "user", content: "Hi", timestamp: ts },
				{
					role: "system",
					content: "Extra rule",
					sections: { env: "<env>linux</env>", skills: null },
					toolsAdded: [readV2],
					toolsRemoved: [{ name: "bash" }],
					timestamp: ts,
				},
				{ role: "user", content: "Again", timestamp: ts },
			]),
		);
		expect(resolved.systemPrompt).toBe("Base prompt\n\nExtra rule\n\n<env>linux</env>");
		expect(resolved.tools).toEqual([readV2]);
		expect(resolved.messages.map((m) => m.role)).toEqual(["user", "user"]);
	});

	it("returns an empty prompt when system messages only declare tools", () => {
		const read = tool("read");
		const resolved = resolveTranscript(
			transcriptContext([
				{ role: "system", content: "", toolsAdded: [read], timestamp: 0 },
				{ role: "user", content: "Hi", timestamp: ts },
			]),
		);
		expect(resolved.systemPrompt).toBe("");
		expect(resolved.tools).toEqual([read]);
	});
});
