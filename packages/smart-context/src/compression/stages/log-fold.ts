const TIMESTAMP_PATTERN = /^\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\]]*\]?\s*/;
const LOG_LEVEL_PATTERN = /\b(DEBUG|INFO|WARN|WARNING|ERROR|FATAL|TRACE|VERBOSE)\b/i;
const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;

interface LogBlock {
  level: string;
  lineIndices: number[];
}

export function foldLogs(text: string): string {
  const lines = text.split("\n");
  if (lines.length < 10) return text;

  const cleaned = lines.map((l) => l.replace(ANSI_ESCAPE, ""));
  const blocks = identifyLogBlocks(cleaned);

  if (blocks.length === 0) return text;

  const errorLines = new Set<number>();
  const importantLines = new Set<number>();

  for (const block of blocks) {
    const level = block.level.toUpperCase();
    if (level === "ERROR" || level === "FATAL") {
      for (const idx of block.lineIndices) {
        errorLines.add(idx);
        if (idx + 1 < cleaned.length && !TIMESTAMP_PATTERN.test(cleaned[idx + 1])) {
          importantLines.add(idx + 1);
        }
        if (idx + 2 < cleaned.length && !TIMESTAMP_PATTERN.test(cleaned[idx + 2])) {
          importantLines.add(idx + 2);
        }
      }
    } else if (level === "WARN" || level === "WARNING") {
      for (const idx of block.lineIndices) importantLines.add(idx);
    }
  }

  if (errorLines.size === 0 && importantLines.size === 0) {
    return foldRepetitiveLines(cleaned);
  }

  const output: string[] = [];
  let skipped = 0;

  for (let i = 0; i < cleaned.length; i++) {
    if (errorLines.has(i) || importantLines.has(i)) {
      if (skipped > 0) {
        output.push(`[... ${skipped} info/debug lines ...]`);
        skipped = 0;
      }
      output.push(cleaned[i]);
    } else if (isLogLine(cleaned[i])) {
      skipped++;
    } else {
      if (skipped > 0) {
        output.push(`[... ${skipped} info/debug lines ...]`);
        skipped = 0;
      }
      output.push(cleaned[i]);
    }
  }

  if (skipped > 0) {
    output.push(`[... ${skipped} info/debug lines ...]`);
  }

  const result = output.join("\n");
  return result.length < text.length ? result : text;
}

function identifyLogBlocks(lines: string[]): LogBlock[] {
  const byLevel = new Map<string, number[]>();

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(LOG_LEVEL_PATTERN);
    if (match) {
      const level = match[1].toUpperCase();
      const arr = byLevel.get(level) ?? [];
      arr.push(i);
      byLevel.set(level, arr);
    }
  }

  const blocks: LogBlock[] = [];
  for (const [level, lineIndices] of byLevel) {
    blocks.push({ level, lineIndices });
  }
  return blocks;
}

function isLogLine(line: string): boolean {
  return TIMESTAMP_PATTERN.test(line) || LOG_LEVEL_PATTERN.test(line);
}

function foldRepetitiveLines(lines: string[]): string {
  if (lines.length <= 20) return lines.join("\n");

  const head = lines.slice(0, 5);
  const tail = lines.slice(-5);
  const omitted = lines.length - 10;

  return [...head, `[... ${omitted} repetitive log lines ...]`, ...tail].join("\n");
}
