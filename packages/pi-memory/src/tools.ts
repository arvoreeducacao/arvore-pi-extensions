import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { createCurated, search } from "./api.js";

const CATEGORIES = ["decisions", "conventions", "incidents", "domain", "gotchas"];

export function registerMemoryTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "memory_search",
    label: "Search Team Memory",
    description:
      "Search the team's shared memory (cloud) for relevant past decisions, conventions, incidents, domain knowledge, and gotchas. Use before starting a task to recover context, or whenever you need to know why something is the way it is.",
    promptSnippet:
      "memory_search — search the team's shared cloud memory for past decisions, conventions, incidents, domain knowledge and gotchas.",
    promptGuidelines: [
      "Before starting a non-trivial task, call memory_search to recover relevant team context.",
      "When you learn a durable decision, convention, gotcha or domain fact worth keeping, call memory_save.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "What to search for" }),
      tier: Type.Optional(
        Type.String({ description: "raw | curated. Omit to search both." })
      ),
      category: Type.Optional(
        Type.String({ description: CATEGORIES.join(" | ") })
      ),
      limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
    }),
    async execute(_toolCallId, params) {
      try {
        const results = await search(params.query, {
          tier: params.tier,
          category: params.category,
          limit: params.limit,
        });

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: "No relevant memories found." }],
            details: { count: 0 },
          };
        }

        const text = results
          .map((r, i) => {
            const header = r.title ? `**${r.title}**` : `(${r.tier})`;
            return `${i + 1}. ${header} [${(r.score * 100).toFixed(0)}%]\n${r.content}`;
          })
          .join("\n\n");

        return { content: [{ type: "text", text }], details: { count: results.length } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `memory_search failed: ${message}` }],
          details: { count: 0 },
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "memory_save",
    label: "Save Team Memory",
    description:
      "Save a curated memory to the team's shared cloud memory: a decision, convention, incident learning, domain fact, or gotcha. Use for durable knowledge the team should not have to rediscover.",
    parameters: Type.Object({
      title: Type.String({ description: "Short, descriptive title" }),
      category: Type.String({ description: CATEGORIES.join(" | ") }),
      content: Type.String({ description: "Full memory content in markdown" }),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Tags" })),
    }),
    async execute(_toolCallId, params) {
      try {
        const category = CATEGORIES.includes(params.category) ? params.category : "domain";
        const result = await createCurated({
          title: params.title,
          category,
          content: params.content,
          tags: params.tags,
        });
        return {
          content: [{ type: "text", text: `Saved curated memory (${result.id}).` }],
          details: { id: result.id },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `memory_save failed: ${message}` }],
          details: { id: "" },
          isError: true,
        };
      }
    },
  });
}
