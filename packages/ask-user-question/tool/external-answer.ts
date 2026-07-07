import type { AskUserAnswerEventPayload } from "../events.js";
import type { QuestionAnswer, QuestionnaireResult, QuestionParams } from "./types.js";

/**
 * Map an external answer payload (e.g. from a Slack button click) onto a
 * `QuestionnaireResult`, the same shape the terminal overlay produces. Labels
 * are validated against the authored options; unknown labels fall back to a
 * free-text (`custom`) answer so a listener can also send arbitrary text.
 * Questions with no matching entry are left unanswered (the envelope builder
 * treats a partial/empty set as a decline).
 */
export function externalAnswerToResult(
	payload: AskUserAnswerEventPayload,
	params: QuestionParams,
): QuestionnaireResult {
	if (payload.cancelled) {
		return { answers: [], cancelled: true };
	}

	const answers: QuestionAnswer[] = [];
	for (const entry of payload.answers ?? []) {
		const i = entry.questionIndex;
		const question = params.questions[i];
		if (!question) continue;

		if (Array.isArray(entry.labels) && entry.labels.length > 0) {
			const valid = entry.labels.filter((l) => question.options.some((o) => o.label === l));
			if (valid.length === 0) continue;
			answers.push({ questionIndex: i, question: question.question, kind: "multi", answer: null, selected: valid });
			continue;
		}

		if (typeof entry.label === "string" && entry.label.length > 0) {
			const match = question.options.find((o) => o.label === entry.label);
			if (match) {
				answers.push({
					questionIndex: i,
					question: question.question,
					kind: "option",
					answer: match.label,
					preview: typeof match.preview === "string" && match.preview.length > 0 ? match.preview : undefined,
				});
				continue;
			}
		}

		if (typeof entry.text === "string" && entry.text.length > 0) {
			answers.push({ questionIndex: i, question: question.question, kind: "custom", answer: entry.text });
		}
	}

	return { answers, cancelled: false };
}
