import { slackifyMarkdown } from "slackify-markdown";

export function toSlackMarkdown(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  try {
    return slackifyMarkdown(trimmed).trim();
  } catch {
    return trimmed;
  }
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}\u2026` : clean;
}

const QUESTION_TOOLS = new Set(["ask_user_question", "questionnaire"]);

export function isQuestionTool(toolName: string): boolean {
  return QUESTION_TOOLS.has(toolName);
}

export interface NormalizedOption {
  label: string;
  description?: string;
}

export interface NormalizedQuestion {
  prompt: string;
  header?: string;
  options: NormalizedOption[];
  multiSelect: boolean;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeOption(raw: unknown): NormalizedOption | undefined {
  const o = raw as Record<string, unknown>;
  const label = asString(o?.label) || asString(o?.value);
  if (!label) return undefined;
  const description = asString(o?.description);
  return { label, description: description || undefined };
}

export function parseQuestions(args: unknown): NormalizedQuestion[] {
  const a = (args ?? {}) as Record<string, unknown>;
  const rawQuestions = Array.isArray(a.questions) ? a.questions : [];
  const questions: NormalizedQuestion[] = [];
  for (const raw of rawQuestions) {
    const q = raw as Record<string, unknown>;
    const prompt = asString(q?.question) || asString(q?.prompt);
    if (!prompt) continue;
    const options = Array.isArray(q?.options)
      ? q.options.map(normalizeOption).filter((o): o is NormalizedOption => Boolean(o))
      : [];
    questions.push({
      prompt,
      header: asString(q?.header) || asString(q?.label) || undefined,
      options,
      multiSelect: q?.multiSelect === true,
    });
  }
  return questions;
}

export const QUESTION_ACTION_PREFIX = "sbq";

export function buildActionId(questionIndex: number, optionIndex: number): string {
  return `${QUESTION_ACTION_PREFIX}_${questionIndex}_${optionIndex}`;
}

export function parseActionId(actionId: string): { questionIndex: number; optionIndex: number } | undefined {
  const match = /^sbq_(\d+)_(\d+)$/.exec(actionId);
  if (!match) return undefined;
  return { questionIndex: Number(match[1]), optionIndex: Number(match[2]) };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface QuestionRender {
  text: string;
  blocks: unknown[];
}

export function buildQuestionBlocks(
  questions: NormalizedQuestion[],
  answers: Map<number, string>,
): QuestionRender {
  const blocks: unknown[] = [];
  const single = questions.length === 1;

  questions.forEach((q, qi) => {
    const heading = single ? q.prompt : `${qi + 1}. ${q.prompt}`;
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${heading}*` } });

    const descriptions = q.options
      .filter((opt) => opt.description)
      .map((opt) => `- *${opt.label}* — ${opt.description}`);
    if (descriptions.length > 0) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: descriptions.join("\n") } });
    }

    const answered = answers.get(qi);
    if (answered !== undefined) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `Respondido: *${answered}*` }],
      });
      return;
    }

    const buttons = q.options.map((opt, oi) => ({
      type: "button",
      text: { type: "plain_text", text: truncate(opt.label, 75), emoji: false },
      action_id: buildActionId(qi, oi),
      value: `${qi}:${oi}`,
    }));
    for (const group of chunk(buttons, 5)) {
      blocks.push({ type: "actions", elements: group });
    }
    if (q.multiSelect) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: "Pode escolher mais de uma respondendo por texto." }],
      });
    }
  });

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: "Clique numa opção ou responda por texto." }],
  });

  const text = questions.map((q) => q.prompt).join(" / ");
  return { text, blocks };
}

export function consolidateAnswers(questions: NormalizedQuestion[], answers: Map<number, string>): string {
  if (questions.length === 1) return answers.get(0) ?? "";
  return questions.map((_, i) => `${i + 1}. ${answers.get(i) ?? ""}`).join("\n");
}
