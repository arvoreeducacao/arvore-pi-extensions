# @arvoretech/pi-cloud-sessions

Sync your pi sessions to a cloud backend so you can start a conversation on one
machine and resume it on another. The full session is synced — messages, tree,
labels, and the session name — by mirroring the JSONL files pi stores under
`~/.pi/agent/sessions/`.

Two backends are supported:

- **git** — a private Git repo you own (versioned history, free, works anywhere).
- **icloud** — a folder inside iCloud Drive (zero infra, Macs on the same Apple ID).

## How it works

pi stores each session as a JSONL file under
`<agent-dir>/sessions/--<project-path>--/<timestamp>_<uuid>.jsonl`. This
extension mirrors that tree to the chosen backend:

- On startup it **pulls** newer sessions from the backend into your local store.
- Every `pollIntervalMs` (default 60s) it **pulls in the background**, so sessions created on another machine show up in `/resume` even while pi is open.
- Before resuming/switching to a session it **pulls** so the loaded session is the freshest version.
- After each turn it **pushes** the current state (debounced).
- On shutdown it flushes a final sync.

Conflict resolution is **last-write-wins per file** by modification time. File
mtimes are preserved across machines so the newest edit wins regardless of which
machine synced last. Sessions are append-only/branching, so concurrent edits to
the same file are rare.

## Setup

Run the setup command inside pi:

```bash
/cloud-sessions-setup
```

It asks for the backend and writes `~/.config/pi/cloud-sessions.json`.

### Git backend

Create an **empty private repo** (e.g. `git@github.com:you/pi-sessions.git`) and
make sure your local `git` can push to it (SSH key or `gh auth`). Then:

```jsonc
// ~/.config/pi/cloud-sessions.json
{
  "provider": "git",
  "git": { "repo": "git@github.com:you/pi-sessions.git", "branch": "main" }
}
```

The repo is cloned to `~/.config/pi/cloud-sessions/repo` and kept in sync.

### iCloud backend

```jsonc
{
  "provider": "icloud",
  "icloud": {
    "dir": "~/Library/Mobile Documents/com~apple~CloudDocs/pi-sessions"
  }
}
```

## Resuming on another machine

Everything is automatic — you never have to run a sync command:

1. Use pi on machine A. Sessions push after each turn.
2. Open pi on machine B (same project path). Startup pull brings A's sessions; background polling keeps them coming even if B was already open.
3. Run `/resume` — A's session is listed. Pick it and continue.

**Caveat — session must share the same `cwd`.** Sessions are stored per working
directory (`--<project-path>--`). For a session to appear in `/resume` on machine
B, B must be in the same absolute project path as A. If your username/home path
differs between machines, the paths won't match.

**Caveat — no live two-way editing.** The sync is serial: finish on one machine,
continue on the other. A session already loaded in memory is not hot-reloaded
when a newer version is pulled.

## Commands

- `/cloud-sessions-sync` — pull + push now (optional; sync is automatic).
- `/cloud-sessions-status` — show config and current state.
- `/cloud-sessions-setup` — configure the backend interactively.

## Configuration

All options can be set in `~/.config/pi/cloud-sessions.json` or via env vars:

| Setting        | JSON key         | Env var                            | Default                |
| -------------- | ---------------- | ---------------------------------- | ---------------------- |
| Backend        | `provider`       | `PI_CLOUD_SESSIONS_PROVIDER`       | `git`                  |
| Auto push      | `autoPush`       | `PI_CLOUD_SESSIONS_AUTO_PUSH`      | `true`                 |
| Pull on start  | `pullOnStart`    | `PI_CLOUD_SESSIONS_PULL_ON_START`  | `true`                 |
| Push debounce  | `pushDebounceMs` | `PI_CLOUD_SESSIONS_DEBOUNCE_MS`    | `4000`                 |
| Poll interval  | `pollIntervalMs` | `PI_CLOUD_SESSIONS_POLL_MS`        | `60000` (0 disables)   |
| Machine label  | `machineId`      | `PI_CLOUD_SESSIONS_MACHINE_ID`     | hostname               |
| Git repo       | `git.repo`       | `PI_CLOUD_SESSIONS_GIT_REPO`       | —                      |
| Git branch     | `git.branch`     | `PI_CLOUD_SESSIONS_GIT_BRANCH`     | `main`                 |
| iCloud folder  | `icloud.dir`     | `PI_CLOUD_SESSIONS_ICLOUD_DIR`     | iCloud Drive/pi-sessions |

## Privacy

Sessions can contain anything you typed or any file content the agent read.
Use a **private** repo and treat the backend as sensitive. There is no
encryption layer — the JSONL is stored as-is.

## Install

Place the built extension under a trusted pi extensions directory, or load it
directly:

```bash
pi -e ./packages/cloud-sessions/dist/index.js
```
