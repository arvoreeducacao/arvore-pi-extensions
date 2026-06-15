# @arvoretech/pi-elevenlabs-stt

PI extension for push-to-talk speech-to-text using the [ElevenLabs Scribe](https://elevenlabs.io/docs/api-reference/speech-to-text/convert) API.

## What it does

Registers a keyboard shortcut that toggles microphone recording. Press once to start recording from your default mic, press again to stop and transcribe. The resulting text is appended to the editor input.

- **First press**: starts recording from the selected microphone via `ffmpeg` (shows `🎙 recording` in the footer).
- **Second press**: stops recording, sends the audio to ElevenLabs Scribe, and inserts the transcript into the editor (`⏳ transcribing…`).

## Commands

| Command | Description |
|---------|-------------|
| `/stt-devices` | List available microphone inputs and select one. The active device is marked with `✓`; the system default is marked `(default)`. |
| `/stt-device-clear` | Reset back to the system default microphone. |

The selected device is persisted in the session and restored on `--resume`.

## Requirements

- [`ffmpeg`](https://ffmpeg.org/) on `PATH` (used to capture microphone audio).
- An ElevenLabs API key exported as `ELEVENLABS_API_KEY`.

The extension auto-detects the audio input backend:

| Platform | Backend |
|----------|---------|
| macOS | `avfoundation` |
| Linux (PulseAudio / PipeWire) | `pulse` |
| Linux (ALSA only) | `alsa` |

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `ELEVENLABS_API_KEY` | — | **Required.** ElevenLabs API key used for transcription. |
| `ELEVENLABS_STT_SHORTCUT` | `ctrl+alt+t` (Linux/Windows), `ctrl+alt+r` (macOS) | Keyboard shortcut that toggles recording. On macOS, `alt` is the Option key. Avoid `super` (Cmd) — terminals usually don't forward it to pi. |

> Some terminals and window managers reserve `ctrl+alt+t` / `ctrl+cmd+t`. If the shortcut doesn't reach pi, set `ELEVENLABS_STT_SHORTCUT` to another combination (e.g. `alt+t`, `ctrl+alt+r`).

## Privacy

Recorded microphone audio is sent to the ElevenLabs API for transcription. Recordings are written to a temporary file and deleted immediately after transcription (and on session shutdown). Nothing else is stored.

## Notes

- Recordings shorter than 400ms are ignored.
- Uses the `scribe_v2` model with automatic language detection.
- Requires interactive (TUI) mode for the shortcut and editor insertion.
