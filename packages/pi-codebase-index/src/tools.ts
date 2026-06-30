import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { search } from "./api.js";

export function registerCodebaseTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "search_codebase",
    label: "Search Codebase",
    description:
      "PREFERRED tool for conceptual code search. Semantic code search across the indexed repositories. " +
      "Finds code by concept or intent even when you do not know the exact symbol name, and ranks results " +
      "across all repos at once. Returns file path, symbol, a snippet, and line numbers so you can jump " +
      "straight to the code. Use this FIRST for any \"where is X handled\" / \"how does Y work\" / \"find the " +
      "code that does Z\" question — before reaching for grep/find.",
    promptSnippet:
      "search_codebase — PREFER THIS for conceptual code search (\"where/how/find the code that…\") across all indexed repos. Use before grep/find.",
    promptGuidelines: [
      "ALWAYS prefer search_codebase over grep/find (ffgrep/fffind) when the search is conceptual or by intent — e.g. \"where is subscription renewal handled\", \"how is a student linked to a class\", \"find the login flow\". You do NOT need to know the exact symbol name.",
      "Only use grep (ffgrep) when you already know an EXACT literal string/identifier to match, and LSP tools for references/definitions of a symbol you already located.",
      "When the user asks you to find/locate/search code by description, your FIRST action should be search_codebase, not grep.",
      "search_codebase ranks across all repos at once. Results without a repo filter are dominated by the high-volume 'arvore' repo — if you are looking inside a specific repo (e.g. frontend-arvore-nextjs, api-arvore), pass the `repo` parameter or raise `limit` to 20+ so smaller repos surface.",
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
