# @arvoretech/pi-warp-tab-title

PI extension that lets the LLM rename the Warp terminal tab to reflect the current task focus.

## What it does

Registers a `set_tab_title({ emoji, summary })` tool that the LLM can call when the focus of the conversation changes (new task, different repo, different phase). The tool emits an OSC 0 escape sequence via `ctx.ui.setTitle()`, which Warp picks up to rename the active tab.

The last title is persisted in the session via `appendEntry`, so it is restored on `--resume` and on tree navigation.

## Behavior

- **Initial title** on `session_start`: `🤖 {sessionName} · {cwd}` (or just `🤖 {cwd}`).
- **Tool call**: LLM sets `{ emoji, summary }` → tab becomes `<emoji> <summary>`.
- **Resume / tree navigation**: restores the most recent title from session entries.
- **Shutdown**: restores `🤖 {cwd}`.

## Examples

- `📝 Refinement EXP-231`
- `🐛 Debug pi-tui crash`
- `🚀 Deploy api-arvore staging`
- `🔍 Investigar fraude La Salle`

## Notes

- Works in Warp (via OSC 0). Other terminals that honor OSC 0/2 should also work.
- In RPC / print modes, `setTitle` is a no-op — safe.
