# @arvoretech/pi-git-review

A PI extension that opens a **browser-based git diff & PR reviewer**. You read the diff in a
tab, select lines or code, type a question, and it lands in your PI session in real time as
a user message. The agent's answers appear in your terminal (PI TUI).

## How it works

```
/review  ──►  extension starts a localhost HTTP+WS server, opens a browser tab
              │
   browser ──┤  GET /api/diff       → parsed `git diff` (per file + hunks)
              │  GET /api/prs        → open PRs per repo (`gh pr list`)
              │  GET /api/pr-diff    → parsed PR diff + metadata (`gh pr diff/view`)
              │  GET /api/pr-comments→ PR review + conversation comments (REST + GraphQL)
              │  POST /api/pr-comment→ new inline review comment
              │  POST /api/pr-reply  → reply to a review thread
              │  GET /api/pr-merge-status → mergeability + your repo permission (`gh pr view`/`gh repo view`)
              │  POST /api/pr-merge  → merge the PR (`gh pr merge`, optional `--admin`)
              │  WS /ws              → you send { file, lines, code, question },
              │                        a pr_context primer, or comment_thread/comment_batch
              ▼
   extension calls pi.sendUserMessage(...)  → agent answers in the terminal
```

- **HTTP** serves the single-file SPA (`web/index.html`) and the diff JSON.
- **WebSocket** carries each comment from the browser into the agent (`steer` while
  streaming, normal message when idle).
- Replies are **terminal-only** by design — the browser is a pure input surface.

> UI: GitHub-style dark theme. Diff rows are built as HTML in a single pass and
> syntax highlighting runs progressively in idle time, so even large diffs render
> instantly instead of blocking on per-line highlighting.

## Usage

```
/review                 # working tree vs HEAD (default, includes untracked files)
/review staged          # staged changes
/review branch          # current branch vs `main`
/review branch develop  # current branch vs `develop`
/review prs             # list open PRs across all repos and review them
/review 1234            # open PR #1234 directly in the reviewer
/review #1234           # same, leading # is accepted
```

The scope and base can also be changed live from the toolbar in the browser tab. The
**Diff / PRs** tabs at the top switch between reviewing local changes and reviewing open
pull requests.

### Reviewing PRs

The **PRs** tab runs `gh pr list` in each discovered repo and shows every open PR
(grouped by repo, newest first). Click a PR to load its full diff via `gh pr diff`
(base...head, independent of your local checkout). When you open a PR, a one-time
**context primer** — title, author, branch, link, and the PR description — is sent to the
agent so it understands what it is reviewing. Every line question you ask afterwards is
answered with that context in mind. The banner links back to the PR list and out to
GitHub.

#### GitHub comments

The **Comments** button in the PR banner toggles a side panel that pulls the PR's existing
GitHub comments into the tab:

- **Review comments** (line-anchored) are grouped into threads and, when their line is in
  the diff, mark the row with a dot. Click a thread's location to jump to and highlight it.
- **Conversation comments** (general, non-line PR discussion) are listed in their own
  section.
- Resolved threads are **hidden by default**; toggle *Show resolved* to reveal them.
  Resolved/outdated threads are badged.

From each thread you can:

- **Send to agent** — pipes that comment thread to the agent with a header marking it as a
  GitHub comment (single, instant).
- **batch** checkbox — select several threads, then the sticky batch bar lets you add one
  shared note and send them all to the agent as a single prompt.
- **Reply** — post a reply into the existing review thread on GitHub.

To add a **new inline comment**, select line(s) in the diff and choose *Comment on GitHub*
in the popover. It posts a review comment anchored to that line/range (RIGHT side by
default, LEFT for deletions) as your authenticated `gh` user. The panel refreshes after
any successful post or reply.

> Posting comments and replies requires the `gh` CLI to be authenticated with write access
> to the repo.

#### Merging a PR

The PR banner has a **Merge…** button that opens a dialog. It first calls
`/api/pr-merge-status` (`gh pr view` for `mergeable`/`mergeStateStatus`/`isDraft` and
`gh repo view` for your `viewerPermission`) and shows whether the PR is ready, blocked,
conflicting, or a draft. You choose the method (merge commit / squash / rebase) and whether
to delete the branch, then confirm — this runs `gh pr merge <n> --<method>` in the repo.

When the PR is **not** cleanly mergeable **and** you have `ADMIN` permission on the repo,
an **Override with admin privileges** checkbox appears, adding `--admin` to bypass branch
protection. The option is hidden entirely when you lack admin rights, so it never offers a
permission you don't have.

> Merging requires the `gh` CLI authenticated with write (and, for the override, admin)
> access to the repo.

> Requires the [`gh` CLI](https://cli.github.com) installed and authenticated
> (`gh auth status`).

In the tab:

- Click a line number to start a comment on that line.
- **Shift-click** another line number in the same file to select a range.
- Type your question and hit **Send to agent** (or `Enter`). Use `Shift+Enter` for newlines.
- The question, the file/line location, and the selected code are sent to the agent.

It scans the workspace for git repos (`.git` up to depth 4, pruning `node_modules`) and aggregates their diffs,
prefixing paths per repo — so it works in a multi-repo workspace too.

## Discovery (prs-tracker integration)

While the reviewer server is running, git-review writes its `{ baseUrl, token, port }` to a
per-process file in the OS temp dir (`pi-git-review-<pid>.json`) and removes it on session
shutdown. This lets sibling extensions in the same Pi process — notably
[`@arvoretech/pi-prs-tracker`](../prs-tracker) — build deep links straight into a PR
(`…?token=…&mode=prs&pr=<number>`). The file carries the same session token used in the URL,
so treat it as local-only (it lives under your user's temp dir, same trust model as the
browser URL).

## Security

- The server binds to **`127.0.0.1` only** — never exposed on the network.
- Every request (HTTP and WS) is gated by a **random per-session token** in the URL, so
  other local processes or unrelated browser pages cannot post comments into your agent.
- It is a local developer tool; do not port-forward or proxy it.

## Install

It's a workspace package. Build it and load it like the other extensions:

```
pnpm --filter @arvoretech/pi-git-review build
```

Then ensure the package is on PI's extension path (auto-discovered when installed, or load
the built `dist/index.js` directly during development).
