# @arvoretech/pi-git-review

A PI extension that opens a **browser-based git diff reviewer**. You read the diff in a
tab, select lines or code, type a question, and it lands in your PI session in real time as
a user message. The agent's answers appear in your terminal (PI TUI).

## How it works

```
/review  ──►  extension starts a localhost HTTP+WS server, opens a browser tab
              │
   browser ──┤  GET /api/diff   → parsed `git diff` (per file + hunks)
              │  WS /ws          → you send { file, lines, code, question }
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
```

The scope and base can also be changed live from the toolbar in the browser tab.

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
