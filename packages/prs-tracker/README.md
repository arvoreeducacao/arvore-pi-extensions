# @arvoretech/pi-prs-tracker

Keeps your open and recently-merged PRs pinned in the chat as a persistent widget — now with CI and production deploy status. PRs are auto-detected from `gh pr create` calls (and any GitHub PR URL) the agent runs during the session, and their status is refreshed in the background. The current status of every tracked PR is also injected into the AI's context on each LLM call, so the agent always knows whether a PR is merged and how its CI/deploy is doing.

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
- For each tracked PR it runs `gh pr view <n> --json ...` to read title, state, merge commit and the status check rollup (CI).
- When a tracked PR becomes `MERGED`, it looks up the production deploy workflow run triggered by the `push` for that merge commit (`gh run list --commit <sha>`) and tracks it through `queued → in_progress → success/failure`.
- A widget pinned above the editor lists every tracked PR with:
  - State: `[open]` / `[draft]` / `[merged]` / `[closed]`
  - CI: `CI passed` / `CI failed` / `CI running` with check counts
  - Deploy: `deploy queued` / `deploying to main` / `deployed to main` / `deploy failed`
- Background polling (every 60s) refreshes CI and deploy statuses. Merged PRs stay for 24h (and are kept longer if a deploy is still in flight); closed PRs drop off immediately.

## AI context injection

On every LLM call the extension injects a non-displayed `custom` message (`customType: "prs-tracker-context"`) with a fresh snapshot of all tracked PRs — state (`OPEN`/`MERGED`/`CLOSED`), CI summary and deploy status. The block is rebuilt each call from the latest background poll and the previous one is filtered out, so the history is never polluted and the agent always sees the current state instead of stale info. This lets the agent answer "is this PR merged / did CI pass / did it deploy?" without re-running `gh`.

## Deploy detection

The production deploy run is matched by the `push` event on the merge commit, picking a workflow whose name contains `deploy` but not `staging`. This matches the `Deploy` workflow in `api-arvore`, `frontend-arvore-nextjs`, etc.

## Commands

- `/prs` — show usage
- `/prs hide` — hide the widget
- `/prs show` — re-show the widget
- `/prs refresh` — force an immediate status refresh

## Requirements

- GitHub CLI (`gh`) authenticated in the working directory.
