// ABOUTME: Reads the system prompt and tool set from either context shape pi hands a provider.
// ABOUTME: Pi 0.86+ carries them in "system" messages; older hosts use context.systemPrompt and context.tools.

import type { Context, Message, TextContent, Tool } from "@earendil-works/pi-ai";

interface SystemMessage {
	role: "system";
	content: string | TextContent[];
	sections?: Record<string, string | null>;
	toolsAdded?: Tool[];
	toolsRemoved?: Array<{ name: string }>;
}

export interface ResolvedTranscript {
	systemPrompt: string;
	tools: Tool[];
	messages: Message[];
}

function isSystemMessage(message: { role: string }): message is SystemMessage {
	return message.role === "system";
}

function contentText(content: string | TextContent[]): string {
	if (typeof content === "string") return content;
	return content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

// Mirrors pi-ai's getCurrentSystemPrompt() and getCurrentTools() so the provider
// works on hosts that predate those helpers.
export function resolveTranscript(context: Context): ResolvedTranscript {
	const systemMessages = (context.messages as Array<{ role: string }>).filter(
		isSystemMessage,
	);
	if (systemMessages.length === 0) {
		return {
			systemPrompt: context.systemPrompt ?? "",
			tools: context.tools ?? [],
			messages: context.messages,
		};
	}

	const content: string[] = [];
	const sections = new Map<string, string>();
	const tools = new Map<string, Tool>();
	for (const message of systemMessages) {
		const text = contentText(message.content);
		if (text.length > 0) content.push(text);
		for (const [name, value] of Object.entries(message.sections ?? {})) {
			if (value === null) sections.delete(name);
			else sections.set(name, value);
		}
		for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name);
		for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool);
	}

	return {
		systemPrompt: [content.join("\n\n"), ...sections.values()]
			.filter((part) => part.length > 0)
			.join("\n\n"),
		tools: [...tools.values()],
		messages: context.messages.filter((message) => !isSystemMessage(message)),
	};
}
