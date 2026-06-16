const MAX_TOOL_RESULT_CHARS = 4000;
const TRUNCATE_TO = 2000;

export function trimToolResults(text: string, age: number): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;

  const scaledLimit = Math.max(
    500,
    Math.floor(TRUNCATE_TO * Math.max(0.2, 1 - age * 0.15))
  );

  const lines = text.split("\n");

  if (lines.length <= 10) {
    return text.slice(0, scaledLimit) + `\n[... truncated, ${text.length - scaledLimit} chars omitted ...]`;
  }

  const headCount = Math.floor(scaledLimit * 0.4 / avgLineLen(lines));
  const tailCount = Math.floor(scaledLimit * 0.4 / avgLineLen(lines));

  const head = lines.slice(0, Math.max(3, headCount));
  const tail = lines.slice(-Math.max(3, tailCount));
  const omitted = lines.length - head.length - tail.length;

  return [...head, `[... ${omitted} lines, ${text.length} chars total ...]`, ...tail].join("\n");
}

function avgLineLen(lines: string[]): number {
  if (lines.length === 0) return 40;
  const total = lines.reduce((sum, l) => sum + l.length, 0);
  return Math.max(1, total / lines.length);
}
