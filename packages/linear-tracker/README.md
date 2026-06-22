# @arvoretech/pi-linear-tracker

Pins the active Linear issue link in the chat as a compact persistent widget. The issue is auto-detected from any `linear.app/<team>/issue/<ID>` URL that shows up in a tool command or its output during the session, and can also be set manually.

## Install

```bash
pi install npm:@arvoretech/pi-linear-tracker
```

Or in `.pi/settings.json`:

```json
{
  "packages": ["npm:@arvoretech/pi-linear-tracker"]
}
```

## How it works

- Listens to tool executions. When a command or its output contains a Linear issue URL, the latest one is captured automatically and pinned.
- The widget pinned above the editor shows the issue ID (e.g. `EXP-231`), a title derived from the URL slug when present, and the full URL.
- State is persisted per session, so the pinned issue survives restarts of the same session.

## Commands

- `/linear` — show the currently pinned issue (or usage)
- `/linear <url>` — pin a specific Linear issue
- `/linear hide` — hide the widget
- `/linear show` — re-show the widget
- `/linear clear` — unpin the issue

## Keeping the screen clean

The widget is two compact lines (issue + URL) and shares the `aboveEditor` placement. Use `/linear hide` whenever you don't need it on screen; the pinned link is restored with `/linear show`.
