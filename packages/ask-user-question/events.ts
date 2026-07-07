/**
 * Public event contract for @arvoretech/pi-ask-user-question.
 *
 * STABILITY POLICY — applies to every event in the `arvore:ask-user:*` namespace.
 *
 *   1. Channel names are immutable. Once shipped, never rename.
 *   2. Payload changes are append-only. Listeners MUST tolerate unknown
 *      fields. New fields ship as optional (`?:`).
 *   3. Breaking changes require a NEW channel, e.g. `arvore:ask-user:prompt.v2`,
 *      with dual-emit during a deprecation window.
 *   4. No `version` field inside payloads. Version via channel name only.
 *   5. Payloads must be JSON-safe: primitives, arrays, plain objects.
 *
 * Naming: `arvore:<tool>:<phase>`, lowercase, hyphen-separated.
 */

/** Emitted when the questionnaire opens, for external listeners (e.g. Slack bridge). */
export const ASK_USER_PROMPT_EVENT = "arvore:ask-user:prompt" as const;

/**
 * Emitted BY an external listener to answer a pending questionnaire from
 * outside the terminal (e.g. a Slack button click). The tool races this event
 * against the terminal overlay: whichever resolves first wins, the other is
 * cancelled. `promptId` correlates the answer with the prompt event.
 */
export const ASK_USER_ANSWER_EVENT = "arvore:ask-user:answer" as const;

export interface AskUserPromptEventPayload {
	/** Correlation id for this prompt; echo it back in the answer payload. */
	promptId: string;
	questions: ReadonlyArray<AskUserPromptQuestion>;
}

export interface AskUserPromptQuestion {
	/** The full question text, exactly as the agent authored it. */
	question: string;
	/** The short chip/tag shown next to the question. */
	header: string;
	/** True iff the user may pick multiple options. Normalized from optional. */
	multiSelect: boolean;
	options: ReadonlyArray<AskUserPromptOption>;
}

export interface AskUserPromptOption {
	label: string;
	description: string;
	/** True iff the option carries rich preview content (content not shipped). */
	hasPreview: boolean;
}

/**
 * Answer payload sent by an external listener. Provide, per question index,
 * either a chosen option `label` (single-select), an array of `labels`
 * (multi-select), or free `text`. Questions omitted are treated as unanswered.
 */
export interface AskUserAnswerEventPayload {
	/** Must match the `promptId` from the prompt event; stale answers are ignored. */
	promptId: string;
	/** True to cancel/decline the questionnaire entirely. */
	cancelled?: boolean;
	answers?: ReadonlyArray<AskUserExternalAnswer>;
}

export interface AskUserExternalAnswer {
	questionIndex: number;
	/** Chosen option label (single-select). */
	label?: string;
	/** Chosen option labels (multi-select). */
	labels?: string[];
	/** Free-text answer. */
	text?: string;
}
