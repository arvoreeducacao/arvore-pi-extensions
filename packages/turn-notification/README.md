# @arvoretech/pi-turn-notification

Pi extension that sends a native desktop notification at the end of each agent turn.

Works on macOS and Linux:

- **macOS**: uses `osascript` to trigger native notifications with the "Glass" sound.
- **Linux**: uses `notify-send` (libnotify) for the notification, and plays a sound via `canberra-gtk-play` or `paplay` when available.

On Linux, make sure `libnotify` is installed (`notify-send` binary). The sound is best-effort and silently skipped if no player is available.

## Install

```bash
pnpm add @arvoretech/pi-turn-notification
```

## Usage

Add to your `.pi/config.json`:

```json
{
  "extensions": ["@arvoretech/pi-turn-notification"]
}
```
