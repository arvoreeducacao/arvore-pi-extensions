# @arvoretech/pi-slack-tracker

Pins the active Slack thread/channel link in the chat as a compact persistent widget. The link is auto-detected from any `slack.com/archives/...` or `app.slack.com/client/...` URL that shows up in a tool command or its output during the session, and can also be set manually.

## Install

```bash
pi install npm:@arvoretech/pi-slack-tracker
```

Or in `.pi/settings.json`:

```json
{
  "packages": ["npm:@arvoretech/pi-slack-tracker"]
}
```

## How it works

- Listens to tool executions. When a command or its output contains a Slack URL, the latest one is captured automatically and pinned.
- The widget pinned above the editor shows the workspace (when present), whether it's a thread or channel, the channel id, and the full URL.
- State is persisted per session, so the pinned link survives restarts of the same session.

## Commands

- `/slack` — show the currently pinned link (or usage)
- `/slack <url>` — pin a specific Slack thread/channel
- `/slack hide` — hide the widget
- `/slack show` — re-show the widget
- `/slack clear` — unpin the link

## Keeping the screen clean

The widget is two compact lines (channel + URL) and shares the `aboveEditor` placement. Use `/slack hide` whenever you don't need it on screen; the pinned link is restored with `/slack show`.
