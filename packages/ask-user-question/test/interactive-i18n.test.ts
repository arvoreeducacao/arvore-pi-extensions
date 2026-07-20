import { beforeEach, describe, expect, it, vi } from "vitest";

const validQuestion = {
	question: "Which option?",
	header: "Choice",
	options: [
		{ label: "First", description: "Use the first option" },
		{ label: "Second", description: "Use the second option" },
	],
};

const i18nMock = vi.hoisted(() => ({
	initializeI18n: vi.fn<() => Promise<void>>(),
}));

vi.mock("../state/i18n-bridge.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../state/i18n-bridge.js")>();
	return { ...original, initializeI18n: i18nMock.initializeI18n };
});

vi.mock("../state/questionnaire-session.js", () => ({
	QuestionnaireSession: class {
		component = {};
	},
}));

describe("interactive initialization", () => {
	beforeEach(() => {
		i18nMock.initializeI18n.mockReset().mockResolvedValue();
	});

	it("registers the tool synchronously without initializing i18n", async () => {
		const { default: extension } = await import("../index.js");
		const registerTool = vi.fn();

		extension({ registerTool } as never);

		expect(registerTool).toHaveBeenCalledTimes(1);
		expect(i18nMock.initializeI18n).not.toHaveBeenCalled();
	});

	async function createTool() {
		const { registerAskUserQuestionTool } = await import("../ask-user-question.js");
		let tool: any;
		const answerListeners: Array<(payload: unknown) => void> = [];
		const pi = {
			registerTool: (registered: unknown) => {
				tool = registered;
			},
			events: {
				emit: vi.fn(),
				on: vi.fn((_event: string, listener: (payload: unknown) => void) => {
					answerListeners.push(listener);
					return vi.fn();
				}),
			},
		};
		registerAskUserQuestionTool(pi as never);
		return { answerListeners, pi, tool };
	}

	it("keeps no-UI and invalid executions cold", async () => {
		const { tool } = await createTool();

		await tool.execute("call", { questions: [validQuestion] }, undefined, undefined, { hasUI: false });
		await tool.execute("call", { questions: [] }, undefined, undefined, { hasUI: true });

		expect(i18nMock.initializeI18n).not.toHaveBeenCalled();
	});

	it("awaits initialization before exposing the interactive prompt", async () => {
		let finishInitialization!: () => void;
		i18nMock.initializeI18n.mockReturnValue(
			new Promise<void>((resolve) => {
				finishInitialization = resolve;
			}),
		);
		const { answerListeners, pi, tool } = await createTool();
		const custom = vi.fn(() => new Promise(() => {}));
		const execution = tool.execute("call", { questions: [validQuestion] }, undefined, undefined, {
			hasUI: true,
			ui: { custom },
		});

		await Promise.resolve();
		expect(pi.events.emit).not.toHaveBeenCalled();
		expect(custom).not.toHaveBeenCalled();

		finishInitialization();
		await vi.waitFor(() => expect(pi.events.emit).toHaveBeenCalledTimes(1));
		const [, prompt] = pi.events.emit.mock.calls[0];
		await vi.waitFor(() => expect(answerListeners).toHaveLength(1));
		answerListeners[0]({
			promptId: prompt.promptId,
			answers: [{ questionIndex: 0, label: "First" }],
		});

		await expect(execution).resolves.toBeDefined();
		expect(i18nMock.initializeI18n).toHaveBeenCalledTimes(1);
	});
});
