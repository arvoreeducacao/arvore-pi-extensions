import { beforeEach, describe, expect, it, vi } from "vitest";


describe("i18n bridge", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it("uses English fallback before initialization and when the SDK is absent", async () => {
		const { displayLabel, initializeI18n } = await import("../state/i18n-bridge.js");
		const dependencies = {
			loadSdk: vi.fn().mockRejectedValue(new Error("missing")),
			loadLoader: vi.fn().mockRejectedValue(new Error("missing")),
		};

		expect(displayLabel("other")).toBe("Type something.");
		await initializeI18n(dependencies);
		expect(displayLabel("other")).toBe("Type something.");
	});

	it("shares initialization and keeps locale changes live", async () => {
		const { displayLabel, initializeI18n, I18N_NAMESPACE } = await import("../state/i18n-bridge.js");
		let locale = "pt";
		const registerLocalesFromDir = vi.fn();
		const dependencies = {
			loadSdk: vi.fn().mockResolvedValue({
				scope: vi.fn().mockReturnValue((_key: string, fallback: string) =>
					locale === "pt" ? "Digite algo." : fallback,
				),
			}),
			loadLoader: vi.fn().mockResolvedValue({ registerLocalesFromDir }),
		};

		await Promise.all([initializeI18n(dependencies), initializeI18n(dependencies)]);

		expect(dependencies.loadSdk).toHaveBeenCalledTimes(1);
		expect(dependencies.loadLoader).toHaveBeenCalledTimes(1);
		expect(registerLocalesFromDir).toHaveBeenCalledWith(
			I18N_NAMESPACE,
			expect.stringContaining("/index.ts"),
			{ label: "rpiv-ask-user-question" },
		);
		expect(displayLabel("other")).toBe("Digite algo.");

		locale = "en";
		expect(displayLabel("other")).toBe("Type something.");
	});
});
