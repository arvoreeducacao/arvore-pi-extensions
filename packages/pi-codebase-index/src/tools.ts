import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { search } from "./api.js";

export function registerCodebaseTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "search_codebase",
    label: "Search Codebase",
    description:
      "Semantic code search across the indexed repositories. Finds code by concept or intent " +
      "even when you do not know the exact symbol name, and ranks results across all repos at once. " +
      "Returns file path, symbol, a snippet, and line numbers so you can jump straight to the code.",
    promptSnippet:
      "search_codebase — semantic code search by concept/intent across all indexed repos.",
    promptGuidelines: [
      "Use search_codebase when the search is conceptual (\"where is subscription renewal handled\", \"how is a student linked to a class\") and you do not know the exact symbol name.",
      "Prefer grep for an exact literal name you already know, and LSP tools for references/definitions of a known symbol.",
      "search_codebase ranks across all repos at once — omit the repo filter unless you are sure which repo to scope to.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Natural-language description of the code you are looking for" }),
      repo: Type.Optional(
        Type.String({ description: "Restrict to a single repo by name. Omit to search all repos." })
      ),
      lang: Type.Optional(
        Type.String({ description: "Restrict to a language (e.g. typescript, elixir, python)." })
      ),
      limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
    }),
    async execute(_toolCallId, params) {
      try {
        const results = await search(params.query, {
          repo: params.repo,
          lang: params.lang,
          limit: params.limit,
        });

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: "No matching code found." }],
            details: { count: 0 },
          };
        }

        const text = results
          .map((r, i) => {
            const loc =
              r.lineStart != null ? `${r.path}:${r.lineStart}` : r.path;
            const header = `${i + 1}. [${r.repo}] ${loc} — ${r.symbol} (${(r.score * 100).toFixed(0)}%)`;
            return `${header}\n\`\`\`${r.lang}\n${r.snippet}\n\`\`\``;
          })
          .join("\n\n");

        return {
          content: [{ type: "text", text }],
          details: { count: results.length },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `search_codebase failed: ${message}` }],
          details: { count: 0 },
          isError: true,
        };
      }
    },
  });
}
