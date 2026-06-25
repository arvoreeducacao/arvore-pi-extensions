# @arvoretech/pi-lsp

PI extension that bridges Language Server Protocol servers, giving the agent real compiler diagnostics, go-to-definition, find-references, hover types and project-wide rename — instead of guessing from text.

## Tools

| Tool | Purpose |
| --- | --- |
| `lsp_diagnostics` | Real type-checker errors/warnings for a file (e.g. `TS2345`). |
| `lsp_definition` | Resolve a symbol to its definition (1-based line/column). |
| `lsp_references` | Find all references to a symbol across the project. |
| `lsp_hover` | Inferred type signature and docs for a symbol. |
| `lsp_rename` | Compute a safe project-wide rename. Returns edits; does not apply them. |

## Commands

- `/lsp-status` — list configured language servers and their file extensions.

## Supported languages

Driven by a registry (`src/registry.ts`). Currently:

- **TypeScript / JavaScript** (`.ts .tsx .js .jsx .mts .cts .mjs .cjs`) via `typescript-language-server --stdio`.

Adding a language is a single entry in `LANGUAGE_SERVERS` — the JSON-RPC client, lifecycle, and document sync are language-agnostic.

## Requirements

The language server binary must be on `PATH`. For TS/JS:

```bash
pnpm add -g typescript-language-server typescript
```

If a server is missing, the tools return a clear message and the extension stays inert (no crash).

## How it works

- One server instance per `(language, project root)`, lazy-spawned on first use. Root is detected via `tsconfig.json` / `jsconfig.json` / `package.json` / `.git`.
- Documents are synced (`didOpen` / `didChange`) from disk on each call; diagnostics are awaited with a short quiet-period debounce.
- Servers are shut down cleanly on `session_shutdown`.

## Architecture

```
src/
  protocol.ts   LSP type subset
  client.ts     JSON-RPC over stdio (Content-Length framing, request/notify)
  registry.ts   language -> server config
  manager.ts    spawn / lifecycle / root detection / doc sync / high-level ops
  tools.ts      lsp_* tool definitions + output formatting
  index.ts      entry shell (lifecycle + tool registration)
```
