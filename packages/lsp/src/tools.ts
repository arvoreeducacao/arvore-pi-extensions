import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import type { LspManager } from "./manager.js";
import {
  type Diagnostic,
  DiagnosticSeverity,
  type Hover,
  type Location,
} from "./protocol.js";

function relativize(filePath: string, cwd: string): string {
  return filePath.startsWith(cwd + "/") ? filePath.slice(cwd.length + 1) : filePath;
}

function severityLabel(severity?: DiagnosticSeverity): string {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return "error";
    case DiagnosticSeverity.Warning:
      return "warning";
    case DiagnosticSeverity.Information:
      return "info";
    case DiagnosticSeverity.Hint:
      return "hint";
    default:
      return "error";
  }
}

function formatDiagnostics(path: string, cwd: string, diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) return `No diagnostics for ${relativize(path, cwd)}.`;
  const rel = relativize(path, cwd);
  const lines = diagnostics
    .slice()
    .sort((a, b) => a.range.start.line - b.range.start.line)
    .map((d) => {
      const line = d.range.start.line + 1;
      const col = d.range.start.character + 1;
      const code = d.code !== undefined ? ` [${d.source ?? "lsp"} ${d.code}]` : d.source ? ` [${d.source}]` : "";
      return `${rel}:${line}:${col} ${severityLabel(d.severity)}${code}: ${d.message}`;
    });
  const errors = diagnostics.filter((d) => (d.severity ?? 1) === DiagnosticSeverity.Error).length;
  const warnings = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Warning).length;
  return `${rel}: ${errors} error(s), ${warnings} warning(s)\n${lines.join("\n")}`;
}

function uriToRel(uri: string, cwd: string): string {
  const path = uri.startsWith("file://") ? fileURLToPath(uri) : uri;
  return relativize(path, cwd);
}

function formatLocations(locations: Location[], cwd: string): string {
  if (locations.length === 0) return "No results.";
  return locations
    .map((loc) => {
      const line = loc.range.start.line + 1;
      const col = loc.range.start.character + 1;
      return `${uriToRel(loc.uri, cwd)}:${line}:${col}`;
    })
    .join("\n");
}

function formatHover(hover: Hover | null): string {
  if (!hover || !hover.contents) return "No hover information.";
  const { contents } = hover;
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents.map((c) => (typeof c === "string" ? c : c.value)).join("\n\n");
  }
  return contents.value;
}

const NOT_AVAILABLE =
  "No language server available for this file (unsupported language or server not installed).";

export function registerLspTools(pi: ExtensionAPI, getManager: () => LspManager): void {
  pi.registerTool({
    name: "lsp_diagnostics",
    label: "LSP Diagnostics",
    description:
      "Get real compiler/type-checker diagnostics (errors and warnings) for a source file from its language server. Use after editing a file to verify there are no type errors, or to understand why a file fails to compile.",
    promptSnippet: "Get compiler diagnostics (type errors/warnings) for a file via LSP",
    promptGuidelines: [
      "Call lsp_diagnostics after editing a TypeScript/JavaScript file to confirm there are no type errors before moving on.",
      "Prefer lsp_diagnostics over running a full build when you only need to validate a single file.",
    ],
    parameters: Type.Object({
      file: Type.String({ description: "Path to the source file (relative to cwd or absolute)." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await getManager().diagnostics(params.file);
      if (result === undefined) return { content: [{ type: "text", text: NOT_AVAILABLE }], details: {} };
      return {
        content: [{ type: "text", text: formatDiagnostics(result.path, ctx.cwd, result.diagnostics) }],
        details: { path: result.path, count: result.diagnostics.length },
      };
    },
  });

  pi.registerTool({
    name: "lsp_definition",
    label: "LSP Definition",
    description:
      "Find where a symbol is defined using the language server. Provide the file and the line/column of an occurrence of the symbol. Lines and columns are 1-based.",
    promptSnippet: "Jump to a symbol's definition via LSP (1-based line/column)",
    parameters: Type.Object({
      file: Type.String({ description: "Path to the source file." }),
      line: Type.Number({ description: "1-based line number of the symbol." }),
      column: Type.Number({ description: "1-based column number of the symbol." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const locations = await getManager().definition(params.file, {
        line: params.line - 1,
        character: params.column - 1,
      });
      if (locations === undefined) return { content: [{ type: "text", text: NOT_AVAILABLE }], details: {} };
      return {
        content: [{ type: "text", text: formatLocations(locations, ctx.cwd) }],
        details: { count: locations.length },
      };
    },
  });

  pi.registerTool({
    name: "lsp_references",
    label: "LSP References",
    description:
      "Find all references to a symbol across the project using the language server. Provide the file and the 1-based line/column of an occurrence of the symbol.",
    promptSnippet: "Find all references to a symbol via LSP (1-based line/column)",
    parameters: Type.Object({
      file: Type.String({ description: "Path to the source file." }),
      line: Type.Number({ description: "1-based line number of the symbol." }),
      column: Type.Number({ description: "1-based column number of the symbol." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const locations = await getManager().references(params.file, {
        line: params.line - 1,
        character: params.column - 1,
      });
      if (locations === undefined) return { content: [{ type: "text", text: NOT_AVAILABLE }], details: {} };
      return {
        content: [{ type: "text", text: formatLocations(locations, ctx.cwd) }],
        details: { count: locations.length },
      };
    },
  });

  pi.registerTool({
    name: "lsp_hover",
    label: "LSP Hover",
    description:
      "Get type information and documentation for a symbol at a position using the language server. Returns inferred types and JSDoc. Provide the file and 1-based line/column.",
    promptSnippet: "Get a symbol's inferred type and docs via LSP (1-based line/column)",
    parameters: Type.Object({
      file: Type.String({ description: "Path to the source file." }),
      line: Type.Number({ description: "1-based line number of the symbol." }),
      column: Type.Number({ description: "1-based column number of the symbol." }),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const hover = await getManager().hover(params.file, {
        line: params.line - 1,
        character: params.column - 1,
      });
      if (hover === undefined) return { content: [{ type: "text", text: NOT_AVAILABLE }], details: {} };
      if (hover === null) return { content: [{ type: "text", text: "No hover information." }], details: {} };
      return { content: [{ type: "text", text: formatHover(hover) }], details: {} };
    },
  });

  pi.registerTool({
    name: "lsp_rename",
    label: "LSP Rename",
    description:
      "Compute a project-wide rename of a symbol using the language server. Returns the set of edits (files, ranges, new text) WITHOUT applying them — review and apply the edits yourself with the edit tool. Provide the file, 1-based line/column of the symbol, and the new name.",
    promptSnippet: "Compute a safe project-wide symbol rename via LSP (does not apply edits)",
    promptGuidelines: [
      "lsp_rename only returns the edits; you must apply them with the edit/write tools.",
      "Use lsp_rename instead of text search-and-replace when renaming a symbol, to avoid touching unrelated matches.",
    ],
    parameters: Type.Object({
      file: Type.String({ description: "Path to the source file." }),
      line: Type.Number({ description: "1-based line number of the symbol." }),
      column: Type.Number({ description: "1-based column number of the symbol." }),
      newName: Type.String({ description: "The new name for the symbol." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const edit = await getManager().rename(
        params.file,
        { line: params.line - 1, character: params.column - 1 },
        params.newName,
      );
      if (edit === undefined) return { content: [{ type: "text", text: NOT_AVAILABLE }], details: {} };
      if (edit === null) return { content: [{ type: "text", text: "Rename produced no edits (symbol may not be renameable here)." }], details: {} };

      const changes: Record<string, Array<{ range: unknown; newText: string }>> = {};
      if (edit.changes) {
        for (const [uri, edits] of Object.entries(edit.changes)) {
          changes[uriToRel(uri, ctx.cwd)] = edits;
        }
      }
      if (edit.documentChanges) {
        for (const dc of edit.documentChanges) {
          changes[uriToRel(dc.textDocument.uri, ctx.cwd)] = dc.edits;
        }
      }

      const fileCount = Object.keys(changes).length;
      if (fileCount === 0) {
        return { content: [{ type: "text", text: "Rename produced no edits (symbol may not be renameable here)." }], details: {} };
      }

      const summary = Object.entries(changes)
        .map(([file, edits]) => {
          const lines = edits
            .map((e) => {
              const r = e.range as { start: { line: number; character: number } };
              return `  ${r.start.line + 1}:${r.start.character + 1} -> "${e.newText}"`;
            })
            .join("\n");
          return `${file} (${edits.length} edit(s)):\n${lines}`;
        })
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `Rename "${params.newName}" affects ${fileCount} file(s). Apply these edits yourself:\n\n${summary}`,
          },
        ],
        details: { files: fileCount, changes },
      };
    },
  });
}
