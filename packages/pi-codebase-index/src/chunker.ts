import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Chunk } from "./api.js";

const MAX_LINES_PER_CHUNK = 200;
const OVERLAP_LINES = 20;

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".ex": "elixir", ".exs": "elixir",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java", ".kt": "kotlin",
  ".php": "php",
  ".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp", ".hpp": "cpp",
  ".cs": "csharp",
  ".swift": "swift",
  ".sql": "sql",
  ".graphql": "graphql", ".gql": "graphql",
};

function langOf(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot).toLowerCase();
  return LANG_BY_EXT[ext] ?? "text";
}

export async function chunkFile(
  repo: string,
  repoDir: string,
  relPath: string,
  fileHash: string
): Promise<Chunk[]> {
  let content: string;
  try {
    content = await readFile(join(repoDir, relPath), "utf-8");
  } catch {
    return [];
  }

  const lang = langOf(relPath);
  const lines = content.split("\n");

  if (lines.length <= MAX_LINES_PER_CHUNK) {
    return [
      {
        repo,
        path: relPath,
        symbol: relPath,
        lang,
        lineStart: 1,
        lineEnd: lines.length,
        content,
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
    if (end === lines.length) break;
  }

  return chunks;
}
