const MIN_RUN_LENGTH = 3;

export function deduplicateLines(text: string): string {
  const lines = text.split("\n");
  if (lines.length < 6) return text;

  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const run = countRun(lines, i);

    if (run >= MIN_RUN_LENGTH) {
      output.push(lines[i]);
      output.push(`[× ${run} identical lines]`);
      i += run;
      continue;
    }

    const similar = countSimilarRun(lines, i);
    if (similar >= MIN_RUN_LENGTH) {
      const template = extractTemplate(lines.slice(i, i + similar));
      if (template) {
        output.push(`${template} [× ${similar}]`);
        i += similar;
        continue;
      }
    }

    output.push(lines[i]);
    i++;
  }

  return output.join("\n");
}

function countRun(lines: string[], start: number): number {
  let count = 1;
  while (start + count < lines.length && lines[start + count] === lines[start]) {
    count++;
  }
  return count;
}

function countSimilarRun(lines: string[], start: number): number {
  if (!lines[start]?.trim()) return 1;

  const pattern = toPattern(lines[start]);
  let count = 1;

  while (start + count < lines.length) {
    if (toPattern(lines[start + count]) !== pattern) break;
    count++;
  }

  return count;
}

function toPattern(line: string): string {
  return line
    .replace(/\d+/g, "{}")
    .replace(/0x[0-9a-f]+/gi, "{}")
    .replace(/[0-9a-f]{8,}/gi, "{}")
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\s]*/g, "{}")
    .trim();
}

function extractTemplate(lines: string[]): string | null {
  if (lines.length < 2) return null;

  const pattern = toPattern(lines[0]);
  const allMatch = lines.every((l) => toPattern(l) === pattern);
  if (!allMatch) return null;

  return pattern;
}
