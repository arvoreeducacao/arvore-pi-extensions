# @arvoretech/pi-changes-tracker

PI extension that shows changed repos and files across a multi-repo workspace.

## Commands

- `/changed` — Shows a summary of repos and files with uncommitted changes, including `+N -N` per file
- `/changes` — Opens a full-screen scrollable diff viewer with syntax highlighting

## Features

- Auto-discovers git repositories up to 2 levels deep
- Aggregates changes across all sub-repos
- Shows untracked files marked as `new`
- Color-coded diff viewer (green for additions, red for removals)
- Keyboard navigation: `j/k`, `↑/↓`, `space/b` for page, `q/esc` to close

## Install

```bash
pi install @arvoretech/pi-changes-tracker
```
