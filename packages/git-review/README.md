# @arvoretech/pi-git-review

A PI extension that opens a **browser-based git diff & PR reviewer**. You read the diff in a
tab, select lines or code, type a question, and it lands in your PI session in real time as
a user message. The agent's answers appear in your terminal (PI TUI).

## How it works

```
/review  ──►  extension starts a localhost HTTP+WS server, opens a browser tab
              │
   browser ──┤  GET /api/diff     → parsed `git diff` (per file + hunks)
              │  GET /api/prs      → open PRs per repo (`gh pr list`)
              │  GET /api/pr-diff  → parsed PR diff + metadata (`gh pr diff/view`)
              │  WS /ws            → you send { file, lines, code, question }
              │                       or a pr_context primer when a PR is opened
              ▼
   extension calls pi.sendUserMessage(...)  → agent answers in the terminal
```

- **HTTP** serves the single-file SPA (`web/index.html`) and the diff JSON.
- **WebSocket** carries each comment from the browser into the agent (`steer` while
  streaming, normal message when idle).
- Replies are **terminal-only** by design — the browser is a pure input surface.

## Usage

```
/review                 # working tree vs HEAD (default, includes untracked files)
/review staged          # staged changes
/review branch          # current branch vs `main`
/review branch develop  # current branch vs `develop`
/review prs             # list open PRs across all repos and review them
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

> Requires the [`gh` CLI](https://cli.github.com) installed and authenticated
> (`gh auth status`).

In the tab:

- Click a line number to start a comment on that line.
- **Shift-click** another line number in the same file to select a range.
- Type your question and hit **Send to agent** (or `Enter`). Use `Shift+Enter` for newlines.
- The question, the file/line location, and the selected code are sent to the agent.

It scans the workspace for git repos (`.git` up to depth 4, pruning `node_modules`) and aggregates their diffs,
prefixing paths per repo — so it works in a multi-repo workspace too.

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
