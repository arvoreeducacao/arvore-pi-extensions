import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, StringEnum } from "@earendil-works/pi-ai";
import type { MemoryCategory, MemoryStatus } from "./types.js";
import { VALID_CATEGORIES, VALID_STATUSES } from "./types.js";
import { MemoryStore } from "./store.js";

export function registerMemoryTools(pi: ExtensionAPI, store: MemoryStore) {
  pi.registerTool({
    name: "add_memory",
    label: "Add Team Memory",
    description:
      "Capture team knowledge: decisions, conventions, incidents, domain knowledge, or gotchas discovered during development.",
    parameters: Type.Object({
      title: Type.String({ description: "Short, descriptive title" }),
      category: StringEnum(VALID_CATEGORIES, {
        description: "decisions | conventions | incidents | domain | gotchas",
      }),
      content: Type.String({ description: "Full memory content in markdown" }),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Tags for categorization" })),
      author: Type.Optional(Type.String({ description: "Author name or email" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const entry = await store.add({
        title: params.title,
        category: params.category as MemoryCategory,
        content: params.content,
        tags: params.tags,
        author: params.author,
      });

      return {
        content: [
          {
            type: "text",
            text: `Created memory: ${entry.id}\nCategory: ${entry.category}\nTitle: ${entry.title}`,
          },
        ],
        details: { id: entry.id, category: entry.category, title: entry.title },
      };
    },
  });

  pi.registerTool({
    name: "search_memories",
    label: "Search Team Memories",
    description:
      "Search team knowledge base for decisions, conventions, incidents, domain knowledge, and gotchas.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      category: Type.Optional(
        StringEnum(VALID_CATEGORIES, { description: "Filter by category" })
      ),
      status: Type.Optional(
        StringEnum(VALID_STATUSES, { description: "Filter by status (default: active)" })
      ),
      limit: Type.Optional(Type.Number({ description: "Max results (default: 10)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const results = await store.search(params.query, {
        category: params.category as MemoryCategory | undefined,
        status: params.status as MemoryStatus | undefined,
        limit: params.limit,
      });

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "No memories found matching query." }],
          details: {},
        };
      }

      const lines = results.map(
        (r) => `- [${r.category}] **${r.title}** (${r.id}) - score: ${r.score}`
      );

      return {
        content: [{ type: "text", text: `Found ${results.length} memories:\n\n${lines.join("\n")}` }],
        details: { results },
      };
    },
  });

  pi.registerTool({
    name: "get_memory",
    label: "Get Memory Details",
    description: "Get the full content of a specific memory by ID.",
    parameters: Type.Object({
      id: Type.String({ description: "Memory ID" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const entry = await store.get(params.id);

      if (!entry) {
        return {
          content: [{ type: "text", text: `Memory "${params.id}" not found.` }],
          details: {},
        };
      }

      return {
        content: [{ type: "text", text: entry.content }],
        details: {
          id: entry.id,
          title: entry.title,
          category: entry.category,
          date: entry.date,
          author: entry.author,
          tags: entry.tags,
          status: entry.status,
        },
      };
    },
  });

  pi.registerTool({
    name: "list_memories",
    label: "List Team Memories",
    description: "List all team memories, optionally filtered by category and status.",
    parameters: Type.Object({
      category: Type.Optional(
        StringEnum(VALID_CATEGORIES, { description: "Filter by category" })
      ),
      status: Type.Optional(
        StringEnum(VALID_STATUSES, { description: "Filter by status" })
      ),
      limit: Type.Optional(Type.Number({ description: "Max results (default: 50)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const results = await store.list({
        category: params.category as MemoryCategory | undefined,
        status: params.status as MemoryStatus | undefined,
        limit: params.limit,
      });

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "No memories found." }],
          details: {},
        };
      }

      const lines = results.map(
        (r) => `- [${r.category}] **${r.title}** (${r.id})`
      );

      return {
        content: [{ type: "text", text: `${results.length} memories:\n\n${lines.join("\n")}` }],
        details: { count: results.length, memories: results },
      };
    },
  });

  pi.registerTool({
    name: "archive_memory",
    label: "Archive Memory",
    description: "Archive a memory (soft delete, preserved for history).",
    parameters: Type.Object({
      id: Type.String({ description: "Memory ID to archive" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const entry = await store.archive(params.id);

      return {
        content: [{ type: "text", text: `Archived: ${entry.title} (${entry.id})` }],
        details: { id: entry.id, title: entry.title },
      };
    },
  });
}
