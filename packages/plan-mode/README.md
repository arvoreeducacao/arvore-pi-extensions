# @arvoretech/pi-plan-mode

Cursor-style **plan mode** for PI with a real **hard tool gate**.

While plan mode is active the agent is locked into read-only exploration:
`edit` and `write` are blocked and `bash` is restricted to a read-only
allowlist — not by prompt discipline, but by the `tool_call` gate. The agent
physically cannot touch code until you approve the plan with `/build`.

## Features

- **Hard gate**: hides `edit`/`write` via `setActiveTools` AND blocks them in
  `tool_call` (defense in depth). `bash` is allowlisted (blocks `rm`,
  `git commit`, `kubectl apply`, `aws ... delete`, `mix ecto`, redirects, etc.).
- **Plan generation**: the agent asks clarifying questions, researches the
  codebase, and produces a numbered plan under a `Plan:` header.
- **Workspace storage**: on approval the plan is saved to
  `.pi/plans/{date}-{slug}.md` — versionable and shareable.
- **Manual handoff**: nothing executes until you run `/build`.
- **Progress tracking**: numbered steps become a todo list; completed steps are
  marked with `[DONE:n]` and shown in a widget during execution.
- **Session persistence**: state survives `/resume`.

## Commands

- `/plan` — toggle plan mode (read-only, edits blocked). `Ctrl+Alt+P` too.
- `/build` — approve the current plan, save it to `.pi/plans/`, exit plan mode and execute.
- `/todos` — show plan progress.
- `--plan` — flag to start directly in plan mode.

## Flow

1. `/plan` → agent asks questions, explores, and outputs a `Plan:` block.
2. Numbered steps become a todo list. Review/edit the plan (still locked).
3. `/build` → saves the `.md`, restores tools, executes in order with `[DONE:n]` tracking.
4. When every step completes, execution mode ends and normal access is restored.

## Usage

### Global (all projects)

```bash
ln -s $(pwd)/packages/plan-mode/dist ~/.pi/agent/extensions/plan-mode
```

### Project-local

```json
{
  "extensions": ["./path/to/arvore-pi-extensions/packages/plan-mode"]
}
```

## Development

```bash
pnpm install
pnpm --filter @arvoretech/pi-plan-mode build
pnpm --filter @arvoretech/pi-plan-mode lint
```
