# @arvoretech/pi-scheduler

Schedule prompts to run automatically from within pi — like a cron job for your
agent. Tasks fire as **headless pi sessions** or get **appended to the session
they were scheduled from**.

## Schedule types

- `cron` — 5 or 6-field cron expressions, e.g. `0 9 * * 1-5` (weekdays at 9am)
- `once` — ISO timestamp or relative delay, e.g. `+10m`, `+2h`, `2026-08-01T09:00:00Z`
- `interval` — fixed durations, e.g. `30s`, `5m`, `1h`, `1d`

## Delivery modes

- `new-session` — spawns `pi --print "<prompt>"` as a fresh, autonomous headless
  session. Output is captured; non-zero exit or timeout marks the run as failed.
- `origin-session` — spawns `pi --print --session <origin-session-id> "<prompt>"`,
  appending the run to the session the task was scheduled from. If that session
  is the one currently open in this process, the prompt is instead delivered
  in-process as a follow-up user message (avoids two writers on the same
  session file).

Scheduled prompts run non-interactively — write them self-contained, with all
context and file paths included.

## Usage

Ask the agent in natural language ("every weekday at 9am, check the deploy
status"), or manage tasks directly:

- LLM tools: `scheduler_create`, `scheduler_list`, `scheduler_get`,
  `scheduler_update`, `scheduler_delete`, `scheduler_run_now`
- Slash command: `/cron status|list|get|run|enable|disable|delete`

The status line shows how many enabled tasks the scheduler is holding.

## How it works

- Tasks persist to `<dataDir>/tasks.json` (atomic writes), so they survive
  restarts. `dataDir` defaults to `~/.pi/agent/scheduler`, overridable via
  `PI_SCHEDULER_DATA_DIR`.
- A PID-based file lock (`scheduler.lock`) ensures that when several pi
  processes are open, only one fires tasks. The status line shows
  `scheduler: idle (lock held elsewhere)` in the others.
- Timers are process-local and `unref`'d: tasks only fire while a pi process
  holding the lock is running. Missed runs during downtime are not caught up.
- A task interrupted mid-run by a crash is marked as an error on the next
  start (`lastStatus: running` at boot ⇒ "Process was interrupted").
- `once` tasks auto-disable after firing. Run history keeps the last 25 runs.
- Headless child runs get `PI_SCHEDULED_RUN=1` (plus
  `PI_SCHEDULED_TASK_ID`/`PI_SCHEDULED_RUN_ID`); the extension does not start
  the scheduler inside those children, so scheduled runs never nest.

## Safety notes

- `new-session` runs are fully autonomous — the child pi executes its prompt
  with the tools available in print mode. Keep prompts scoped to what you
  would let run unattended.
- Default timeout is 30 minutes per run (`timeoutMs` on the task overrides);
  timed-out children are SIGTERM'd, then SIGKILL'd after 5s.

## Development

```bash
pnpm install
pnpm build
```
