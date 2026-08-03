# @arvoretech/pi-prs-tracker

Keeps your open and recently-merged PRs pinned in the chat as a persistent widget — with CI and production deploy status. PRs are auto-detected from `gh pr create` calls (and any GitHub PR URL) the agent runs during the session, and their status is refreshed in the background.

**Tracking is opt-in.** Since 2.0.0 the extension starts in `off` and does nothing at all — no auto-detection, no `gh` polling, no context injection — until you turn it on.

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

## Modes

| mode | auto-detect | widget | `gh` polling | context injection |
| --- | --- | --- | --- | --- |
| `off` (default) | no | no | no | no |
| `widget` | yes | yes | yes | no |
| `context` | yes | yes | yes | yes |

Set the default per project in `.pi/prs-tracker.json` at the hub root:

```json
{ "mode": "widget" }
```

Or via the `PI_PRS_TRACKER_MODE` env var, which wins over the file. `/prs on|off|widget|context`
changes the mode for the current session only.

`/prs track <url|owner/repo#N|N>` opts a single PR in without enabling auto-detection —
it switches to `widget` if the extension was `off`.

## How it works

- Listens to `bash` tool executions. When a command contains `gh pr create` or its output prints a `github.com/<owner>/<repo>/pull/<n>` URL, the PR is captured automatically.
- For each tracked PR it runs `gh pr view <n> --json ...` to read title, state, merge commit and the status check rollup (CI).
- When a tracked PR becomes `MERGED`, it looks up the production deploy workflow run triggered by the `push` for that merge commit (`gh run list --commit <sha>`) and tracks it through `queued → in_progress → success/failure`.
- A widget pinned above the editor lists every tracked PR with:
  - State: `[open]` / `[draft]` / `[merged]` / `[closed]`
  - CI: `CI passed` / `CI failed` / `CI running` with check counts
  - Deploy: `deploy queued` / `deploying to main` / `deployed to main` / `deploy failed`
- The CI and deploy status labels are **clickable links** (OSC 8 terminal hyperlinks). Cmd/Ctrl-click `CI failed` to open the failing check's logs (or the PR `/checks` tab) and `Deploy failed`/`Deployed to main` to open the workflow run. Terminals without OSC 8 support just show the plain label.
- Background polling (every 60s) refreshes CI and deploy statuses. Merged PRs stay for 24h (and are kept longer if a deploy is still in flight); closed PRs drop off immediately.

## AI context injection

Only in `context` mode. On every LLM call the extension injects a non-displayed `custom` message (`customType: "prs-tracker-context"`) with a fresh snapshot of all tracked PRs — state (`OPEN`/`MERGED`/`CLOSED`), CI summary and deploy status. The block is rebuilt each call from the latest background poll and the previous one is filtered out, so the history is never polluted and the agent always sees the current state instead of stale info. This lets the agent answer "is this PR merged / did CI pass / did it deploy?" without re-running `gh`.

## Deploy detection

The production deploy run is matched by the `push` event on the merge commit, picking a workflow whose name contains `deploy` but not `staging`. This matches the `Deploy` workflow in `api-arvore`, `frontend-arvore-nextjs`, etc.

## Commands

- `/prs` — show the current mode and usage
- `/prs on` — enable full tracking (`context` mode) for this session
- `/prs widget` — enable tracking without context injection
- `/prs off` — stop polling, hide the widget and inject nothing
- `/prs track <pr>` — track one PR explicitly (url, `owner/repo#N` or `N`)
- `/prs hide` — hide the widget (keeps tracking)
- `/prs show` — re-show the widget
- `/prs refresh` — force an immediate status refresh

## Git-review integration

If the [`@arvoretech/pi-git-review`](../git-review) extension is loaded **and** its
reviewer server is running this session (i.e. you ran `/review` at least once), each PR's
link in the widget is swapped from the GitHub URL to a local **git-review** deep link that
opens that PR directly in the reviewer UI (`…?token=…&mode=prs&pr=<number>`).

Discovery is automatic: git-review publishes its `{ baseUrl, token, port }` to a
per-process file in the OS temp dir (`pi-git-review-<pid>.json`) while its server is up and
removes it on shutdown. When git-review isn't running, the widget falls back to the plain
GitHub PR URL. The canonical GitHub URL is always what's injected into the AI's context —
only the clickable widget link changes.

## Requirements

- GitHub CLI (`gh`) authenticated in the working directory.
