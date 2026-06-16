# @arvoretech/pi-turn-notification

Pi extension that sends a macOS desktop notification at the end of each agent turn.

Uses `osascript` to trigger native macOS notifications with the "Glass" sound.

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
