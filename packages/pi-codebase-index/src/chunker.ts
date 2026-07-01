import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { Chunk } from "./api.js";
import { astLangOf, extractDefs } from "./ast.js";
import type { DefNode } from "./ast.js";

const MAX_LINES_PER_CHUNK = 200;
const OVERLAP_LINES = 20;
const MIN_PREAMBLE_LINES = 3;
const MAX_CHUNK_CHARS = 24_000;

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ex": "elixir",
  ".exs": "elixir",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".php": "php",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".swift": "swift",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
};

function langOf(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot).toLowerCase();
  return LANG_BY_EXT[ext] ?? "text";
}

function windowChunks(
  repo: string,
  relPath: string,
  lang: string,
  lines: string[],
  fileHash: string
): Chunk[] {
  if (lines.length <= MAX_LINES_PER_CHUNK) {
    return [
      {
        repo,
        path: relPath,
        symbol: relPath,
        lang,
        lineStart: 1,
        lineEnd: lines.length,
        content: lines.join("\n"),
        fileHash,
      },
    ];
  }

  const chunks: Chunk[] = [];
  const step = MAX_LINES_PER_CHUNK - OVERLAP_LINES;

  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(start + MAX_LINES_PER_CHUNK, lines.length);
    chunks.push({
      repo,
      path: relPath,
      symbol: `${relPath}#L${start + 1}-${end}`,
      lang,
      lineStart: start + 1,
      lineEnd: end,
      content: lines.slice(start, end).join("\n"),
      fileHash,
    });
    if (end === lines.length) {
      break;
    }
  }

  return chunks;
}

function splitDef(
  repo: string,
  relPath: string,
  lang: string,
  lines: string[],
  fileHash: string,
  def: DefNode
): Chunk[] {
  const total = def.lineEnd - def.lineStart + 1;
  if (total <= MAX_LINES_PER_CHUNK) {
    return [
      {
        repo,
        path: relPath,
        symbol: def.symbol,
        lang,
        lineStart: def.lineStart,
        lineEnd: def.lineEnd,
        content: lines.slice(def.lineStart - 1, def.lineEnd).join("\n"),
        fileHash,
      },
    ];
  }

  const chunks: Chunk[] = [];
  const step = MAX_LINES_PER_CHUNK - OVERLAP_LINES;
  let part = 1;

  for (let start = def.lineStart - 1; start < def.lineEnd; start += step) {
    const end = Math.min(start + MAX_LINES_PER_CHUNK, def.lineEnd);
    chunks.push({
      repo,
      path: relPath,
      symbol: `${def.symbol}#part${part}`,
      lang,
      lineStart: start + 1,
      lineEnd: end,
      content: lines.slice(start, end).join("\n"),
      fileHash,
    });
    part += 1;
    if (end === def.lineEnd) {
      break;
    }
  }

  return chunks;
}

function selectDefs(defs: DefNode[]): DefNode[] {
  const sorted = [...defs].sort((a, b) =>
    a.lineStart === b.lineStart ? b.lineEnd - a.lineEnd : a.lineStart - b.lineStart
  );

  const contains = (outer: DefNode, inner: DefNode): boolean =>
    outer !== inner &&
    outer.lineStart <= inner.lineStart &&
    outer.lineEnd >= inner.lineEnd &&
    outer.lineEnd - outer.lineStart > inner.lineEnd - inner.lineStart;

  const kept: DefNode[] = [];

  for (const def of sorted) {
    const children = sorted.filter((other) => contains(def, other));
    const size = def.lineEnd - def.lineStart + 1;
    const isExpandableContainer =
      children.length > 1 || (children.length > 0 && size > MAX_LINES_PER_CHUNK);
    if (isExpandableContainer) {
      continue;
    }
    kept.push(def);
  }

  const result: DefNode[] = [];
  let lastEnd = 0;
  for (const def of kept) {
    if (def.lineStart <= lastEnd) {
      continue;
    }
    result.push(def);
    lastEnd = def.lineEnd;
  }
  return result;
}

async function astChunks(
  repo: string,
  relPath: string,
  astLang: string,
  outputLang: string,
  lines: string[],
  fileHash: string
): Promise<Chunk[] | null> {
  const source = lines.join("\n");
  const defs = await extractDefs(astLang, source);
  if (!defs || defs.length === 0) {
    return null;
  }

  const topLevel = selectDefs(defs);
  if (topLevel.length === 0) {
    return null;
  }

  const symbolCounts = new Map<string, number>();
  for (const def of topLevel) {
    symbolCounts.set(def.symbol, (symbolCounts.get(def.symbol) ?? 0) + 1);
  }
  for (const def of topLevel) {
    if ((symbolCounts.get(def.symbol) ?? 0) > 1) {
      def.symbol = `${def.symbol}@L${def.lineStart}`;
    }
  }

  const chunks: Chunk[] = [];

  const emitGap = (start: number, end: number): void => {
    if (end - start + 1 < MIN_PREAMBLE_LINES) {
      return;
    }
    const slice = lines.slice(start - 1, end);
    if (slice.every((line) => line.trim() === "")) {
      return;
    }
    chunks.push({
      repo,
      path: relPath,
      symbol: `${relPath}#L${start}-${end}`,
      lang: outputLang,
      lineStart: start,
      lineEnd: end,
      content: slice.join("\n"),
      fileHash,
    });
  };

  let cursor = 1;
  for (const def of topLevel) {
    if (def.lineStart > cursor) {
      emitGap(cursor, def.lineStart - 1);
    }
    chunks.push(...splitDef(repo, relPath, outputLang, lines, fileHash, def));
    cursor = Math.max(cursor, def.lineEnd + 1);
  }
  if (cursor <= lines.length) {
    emitGap(cursor, lines.length);
  }

  return chunks;
}

export async function chunkFile(
  repo: string,
  repoDir: string,
  relPath: string,
  fileHash: string
): Promise<Chunk[]> {
  let content: string;
  try {
    const repoRoot = await realpath(repoDir);
    const absPath = resolve(repoDir, relPath);
    const stat = await lstat(absPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return [];
    }
    const realFilePath = await realpath(absPath);
    const relToRoot = relative(repoRoot, realFilePath);
    if (relToRoot.startsWith("..") || isAbsolute(relToRoot)) {
      return [];
    }
    content = await readFile(realFilePath, "utf-8");
  } catch {
    return [];
  }

  const lang = langOf(relPath);
  const lines = content.split("\n");
  const astLang = astLangOf(relPath);

  if (astLang) {
    try {
      const ast = await astChunks(repo, relPath, astLang, lang, lines, fileHash);
      if (ast && ast.length > 0) {
        return capChunkSizes(ast);
      }
    } catch {
      // falls through to window chunking
    }
  }

  return capChunkSizes(windowChunks(repo, relPath, lang, lines, fileHash));
}

function capChunkSizes(chunks: Chunk[]): Chunk[] {
  const result: Chunk[] = [];
  for (const chunk of chunks) {
    if (chunk.content.length <= MAX_CHUNK_CHARS) {
      result.push(chunk);
      continue;
    }
    result.push(...splitChunkByChars(chunk));
  }
  return result;
}

function splitChunkByChars(chunk: Chunk): Chunk[] {
  const parts: Chunk[] = [];
  const content = chunk.content;
  const baseLine = chunk.lineStart ?? 1;
  let offset = 0;
  let part = 1;
  while (offset < content.length) {
    let end = Math.min(offset + MAX_CHUNK_CHARS, content.length);
    if (end < content.length) {
      const lastBreak = content.lastIndexOf("\n", end);
      if (lastBreak > offset) {
        end = lastBreak + 1;
      }
    }
    const slice = content.slice(offset, end);
    const linesBefore = countLines(content.slice(0, offset));
    const sliceLines = countLines(slice);
    const lineStart = baseLine + linesBefore;
    parts.push({
      ...chunk,
      symbol: `${chunk.symbol}#chars${part}`,
      content: slice,
      lineStart,
      lineEnd: lineStart + Math.max(sliceLines - 1, 0),
    });
    offset = end;
    part += 1;
  }
  return parts;
}

function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") {
      count += 1;
    }
  }
  return count;
}
