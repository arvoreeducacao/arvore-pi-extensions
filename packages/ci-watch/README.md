# @arvoretech/pi-ci-watch

Monitors CI status for GitHub PRs and auto-fixes failures. Closes the feedback loop between CI and the coding agent.

## Install

```bash
pi install npm:@arvoretech/pi-ci-watch
```

Or in `.pi/settings.json`:

```json
{
  "packages": ["npm:@arvoretech/pi-ci-watch"]
}
```

## Commands

| Command | Description |
|---------|-------------|
| `/ci-watch <pr>` | Monitor CI and auto-fix failures (up to 3 attempts) |
| `/ci-notify <pr>` | Monitor CI and notify when done (no auto-fix) |
| `/ci-auto on\|off` | Auto-watch after every push (default: off) |
| `/ci-config <min> <max> <step>` | Configure poll intervals in seconds |
| `/ci-config` | Show current config |

## How it works

1. Polls `gh pr checks` with a smart interval (30s → 45s → 60s → 30s...)
2. If CI passed: notifies ✅
3. If CI failed: fetches logs via `gh run view --log-failed`, returns them to the LLM to fix
4. LLM reads the error, fixes the code, commits, pushes
5. Repeats until CI passes (max 3 attempts)

## Auto mode

When enabled with `/ci-auto on`, the extension detects `git push` output and automatically starts monitoring the associated PR.

## Poll configuration

Default: 30s min, 60s max, 15s step. The interval grows from min to max, then resets — never grows infinitely.

```
/ci-config 20 90 10
```

Sets: 20s → 30s → 40s → ... → 90s → 20s → ...

## Requirements

- `gh` CLI installed and authenticated
- Repository with GitHub Actions CI
