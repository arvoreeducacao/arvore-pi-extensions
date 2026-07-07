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

export function renderQuestions(questions: NormalizedQuestion[]): string {
  const parts: string[] = [":question: *Preciso da sua resposta:*"];
  const single = questions.length === 1;
  questions.forEach((q, qi) => {
    const heading = single ? `*${q.prompt}*` : `*${qi + 1}. ${q.prompt}*`;
    parts.push("");
    parts.push(heading);
    q.options.forEach((opt, oi) => {
      const num = single ? `${oi + 1}` : `${qi + 1}.${oi + 1}`;
      const desc = opt.description ? ` — ${opt.description}` : "";
      parts.push(`  \`${num}\` ${opt.label}${desc}`);
    });
    if (q.multiSelect) parts.push("  _(pode escolher mais de uma, separe por vírgula)_");
  });
  parts.push("");
  parts.push(
    single
      ? "_Responda com o número da opção ou escreva sua resposta._"
      : "_Responda com os números (ex: `1.2`) ou escreva sua resposta._",
  );
  return parts.join("\n");
}

export function resolveAnswer(questions: NormalizedQuestion[], reply: string): string {
  const text = reply.trim();
  if (questions.length !== 1) return text;
  const options = questions[0].options;
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  const labels: string[] = [];
  for (const part of parts) {
    const idx = Number.parseInt(part, 10);
    if (Number.isInteger(idx) && idx >= 1 && idx <= options.length && String(idx) === part) {
      labels.push(options[idx - 1].label);
    } else {
      return text;
    }
  }
  return labels.length > 0 ? labels.join(", ") : text;
}
