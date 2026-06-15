# @arvoretech/pi-git-worktrees

PI extension that shows the git worktree you are currently working in and lets you browse all worktrees of the repository.

## What it does

- **Footer status**: while in a git repository, the footer shows the current worktree, e.g. `🌿 feat/kokoro-tts-extension (3 worktrees)`. The branch (or detached HEAD) is the one matching the session's working directory; the count is the total number of worktrees.
- **`/worktrees` command**: opens an interactive list of every worktree in the repository, with the current one marked (`●`). Selecting another worktree lets you open it in your `$EDITOR` or copy a `cd` command to the clipboard.

The current worktree is detected by matching the session `cwd` against each worktree path, so it always reflects the directory pi was launched in.

## Commands

| Command | Description |
|---------|-------------|
| `/worktrees` | List all worktrees, mark the current one, and open/copy another. |

## Notes

- pi runs inside a single worktree per session (the launch directory). This extension cannot switch the running session to another worktree — selecting one offers to open it in `$EDITOR` or copies a `cd` command so you can start a new session there.
- Clipboard copy uses `pbcopy` (macOS), `wl-copy`, `xclip`, or `xsel` (Linux), whichever is available; otherwise the command is shown so you can copy it manually.
- The footer status requires interactive (TUI) mode. In non-interactive mode, `/worktrees` prints the list instead.
- All `git` calls have a 5s timeout and fail silently in the footer if the directory is not a git repository.
