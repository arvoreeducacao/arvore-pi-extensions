const JSON_ARRAY_THRESHOLD = 5;
const MAX_SAMPLE_ROWS = 3;

export function compactJson(text: string): string {
  const jsonBlocks = findJsonBlocks(text);
  if (jsonBlocks.length === 0) return text;

  let result = text;
  for (const block of jsonBlocks.reverse()) {
    const compacted = compactBlock(block.content);
    if (compacted && compacted.length < block.content.length) {
      result = result.slice(0, block.start) + compacted + result.slice(block.end);
    }
  }

  return result;
}

interface JsonBlock {
  start: number;
  end: number;
  content: string;
}

function findJsonBlocks(text: string): JsonBlock[] {
  const blocks: JsonBlock[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] === "[" || text[i] === "{") {
      const end = findMatchingBracket(text, i);
      if (end !== -1 && end - i > 200) {
        blocks.push({ start: i, end: end + 1, content: text.slice(i, end + 1) });
        i = end + 1;
        continue;
      }
    }
    i++;
  }

  return blocks;
}

function findMatchingBracket(text: string, start: number): number {
  const open = text[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (text[i] === "\\") {
      escaped = true;
      continue;
    }
    if (text[i] === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (text[i] === open) depth++;
    if (text[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function compactBlock(json: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (Array.isArray(parsed) && parsed.length >= JSON_ARRAY_THRESHOLD) {
    return compactArray(parsed);
  }

  return null;
}

function compactArray(arr: unknown[]): string {
  if (arr.length === 0) return "[]";

  const first = arr[0];
  if (typeof first !== "object" || first === null) {
    if (arr.length > 20) {
      const sample = arr.slice(0, 5);
      return `[${JSON.stringify(sample).slice(1, -1)}, ... (${arr.length} items total)]`;
    }
    return JSON.stringify(arr);
  }

  const keys = Object.keys(first as Record<string, unknown>);
  const allSameShape = arr.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      arraysEqual(Object.keys(item as Record<string, unknown>).sort(), [...keys].sort())
  );

  if (!allSameShape) {
    const sample = arr.slice(0, MAX_SAMPLE_ROWS);
    return `[${arr.length} items] sample: ${JSON.stringify(sample)}`;
  }

  const header = keys.join(",");
  const rows = arr.slice(0, MAX_SAMPLE_ROWS).map((item) => {
    const obj = item as Record<string, unknown>;
    return keys.map((k) => formatValue(obj[k])).join(",");
  });

  const remaining = arr.length - MAX_SAMPLE_ROWS;
  const footer = remaining > 0 ? `\n... +${remaining} more rows` : "";

  return `[${arr.length} rows]{${header}}: ${rows.join("; ")}${footer}`;
}

function formatValue(val: unknown): string {
  if (val === null) return "null";
  if (typeof val === "string") return val.length > 30 ? val.slice(0, 27) + "..." : val;
  if (typeof val === "object") return JSON.stringify(val).slice(0, 40);
  return String(val);
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
