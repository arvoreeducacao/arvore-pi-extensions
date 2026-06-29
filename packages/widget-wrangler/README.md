# @arvoretech/pi-widget-wrangler 🤠

Round up the widget herd. Every Pi extension can paint a widget above or below
your editor with `ctx.ui.setWidget(...)`. Install a few of them and the screen
gets noisy fast. **Widget Wrangler** corrals every widget — from *any*
extension — into one panel where you flip each one **shown** or **hidden**.

It is fully generic: it does not know or care which extensions you run. Anything
that calls `setWidget` shows up in the corral automatically.

## What it does

- Intercepts `ctx.ui.setWidget` (the shared UI surface all extensions write to)
  and keeps a live registry of every widget, keyed by its id.
- A panel (`/wrangle` or `Ctrl+Shift+W`) lists every widget it has seen, with a
  `shown` / `hidden` toggle each — same feel as Pi's `/mcp` panel.
- Hidden widgets are suppressed before they ever reach the screen. Your choices
  persist per session branch (saved via session entries), so they survive
  reloads and branch navigation.
- It never touches `ctx.ui.notify`, so error/info notifications from your
  extensions still pop up and fade on their own — even for a hidden widget.

## Usage

- `/wrangle` — open the corral.
- `Ctrl+Shift+W` — open the corral (default keybinding, configurable).
- In the panel: arrow keys to move, `space`/`enter` to toggle, type to search,
  `esc` to close. Changes apply instantly.

### Changing the keybinding

The shortcut is a CLI flag, `widget-wrangler-key`. Override it when launching pi:

```bash
pi --widget-wrangler-key=alt+w
```

Pass an empty value to disable the shortcut entirely and rely only on
`/wrangle`:

```bash
pi --widget-wrangler-key=
```

> Note on `Alt`/`Option`: `alt+*` shortcuts are reliable on Linux but depend on
> terminal configuration on macOS (e.g. iTerm2 needs "Use ⌥ as Meta"). The
> default `ctrl+shift+g` is the most portable choice across macOS, Linux, and
> Windows.

## Install

Add it to your Pi extensions (npm package or local). It registers a command and
a shortcut; no configuration required.

## How it works (and one caveat)

All extensions share a single `ctx.ui` object, so wrapping `setWidget` once
intercepts every extension's widget calls. A widget appears in the corral the
first time its owning extension sets it. Most status widgets re-set themselves
every turn, so they show up almost immediately; a widget set exactly once,
before this extension loaded, only becomes controllable after its next update.

## License

MIT
