# @arvoretech/pi-prs-tracker

Keeps your open and recently-merged PRs pinned in the chat as a persistent widget. PRs are auto-detected from `gh pr create` calls (and any GitHub PR URL) the agent runs during the session, and their status is refreshed in the background.

## Install

```bash
pi install npm:@arvoretech/pi-prs-tracker
```

Or in `.pi/settings.json`:

```json
{
  "packages": ["npm:@arvoretech/pi-prs-tracker"]
}
```

## How it works

- Listens to `bash` tool executions. When a command contains `gh pr create` or its output prints a `github.com/<owner>/<repo>/pull/<n>` URL, the PR is captured automatically.
- For each tracked PR it runs `gh pr view <n> --json ...` to read title and state.
- A widget pinned above the editor lists every tracked PR with its state and URL:
  - `[open]` / `[draft]` / `[merged]` / `[closed]`
- Background polling (every 60s) refreshes statuses. Merged PRs stay for 24h, closed PRs drop off immediately.

## Commands

- `/prs` — show usage
- `/prs hide` — hide the widget
- `/prs show` — re-show the widget
- `/prs refresh` — force an immediate status refresh

## Requirements

- GitHub CLI (`gh`) authenticated in the working directory.
