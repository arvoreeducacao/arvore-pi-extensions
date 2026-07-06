# @arvoretech/pi-monitor

Watch a long-running background process and push each matching output line to the agent as a notification — no polling. Inspired by Claude Code's Monitor tool, with stderr + exit-code capture and flood protection on top.

## How it works

```
monitor_start → spawn(command, shell) → readline(stdout/stderr)
                        │
              line matches include/exclude filter
                        │
        pi.sendUserMessage(line, { deliverAs: "steer" })  → agent reacts mid-conversation
```

The agent keeps working and is interrupted only when a matching line arrives. Monitors are session-scoped and are killed on `session_shutdown`.

## Tools

- `monitor_start` — start a background monitor. Params: `id`, `command`, `cwd?`, `include?` (regex), `exclude?` (regex), `captureStderr?` (default true), `reportExit?` (default true), `deliverAs?` (`steer` | `followUp`, default `steer`), `maxEventsPerWindow?` (default 40 / 60s).
- `monitor_stop` — stop by `id`, or `all: true`.
- `monitor_list` — list running monitors with uptime and event counts.

## Command

- `/monitors` — abre o painel de logs (monitores ativos + eventos recentes). Esc fecha.

## Footer

Enquanto houver monitores rodando, um item aparece no rodapé (`1 monitor ativo · /monitors p/ logs`). Ele some sozinho quando o último monitor termina, e pode ser escondido pela extensão `widget-wrangler` (`/wrangle`).

## Notes vs Claude Code Monitor

- Captures **stderr and exit code** (Claude's forwards stdout only, so silent failures look healthy).
- **Filter is applied in-process** via `include`/`exclude` regex to avoid flooding context.
- **Flood guard**: a monitor emitting more than `maxEventsPerWindow` matching lines per 60s window auto-stops and tells the agent to restart with a tighter filter.
- Pipe-buffering caveat still applies to your command: use `grep --line-buffered` when filtering upstream.

## Usage

Add to `.pi/settings.json`:
```json
{ "packages": ["npm:@arvoretech/pi-monitor"] }
```

Then ask in natural language:
> Run `docker compose up --build` in the background and tell me the moment any line contains "error" or when a service reports "healthy".
