# @arvoretech/pi-kokoro-tts

PI extension that speaks the assistant's responses out loud using a [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) text-to-speech endpoint.

Pairs with [`@arvoretech/pi-elevenlabs-stt`](../elevenlabs-stt) to enable a full voice loop: speak to pi (STT), pi answers in text, and this extension reads the answer back to you (TTS).

## What it does

Registers a keyboard shortcut that toggles **voice mode**. While voice mode is on, every final assistant response is streamed to the Kokoro endpoint (`POST /v1/audio/speech`) and played through `ffplay` as it arrives.

- **Toggle voice mode**: press the shortcut (default `ctrl+super+s` on macOS, `ctrl+alt+s` elsewhere). The footer shows `🔊 voice on` while enabled.
- Audio streams in `pcm` (24 kHz mono) directly into `ffplay`, so playback starts before the full response is synthesized.
- A new response interrupts any playback already in progress.
- The voice-mode state is persisted in the session and restored on `--resume`.

## Commands

| Command | Description |
|---------|-------------|
| `/say [text]` | Speak the given text. With no argument, repeats the last spoken response. |
| `/tts-stop` | Stop the current playback. |

## Requirements

- [`ffplay`](https://ffmpeg.org/) on `PATH` (ships with `ffmpeg`; used to play the audio stream).
- A reachable Kokoro-FastAPI endpoint (see configuration).

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `KOKORO_TTS_URL` | `https://tts.arvore.com.br/v1` | Base URL of the Kokoro-FastAPI OpenAI-compatible API (without trailing slash). |
| `KOKORO_TTS_API_KEY` | falls back to `ARVORE_TTS_API_KEY` | API key sent as the `X-API-Key` header. Required by the Arvore Kokoro gateway. |
| `KOKORO_TTS_VOICE` | `pf_dora` | Voice name. `pf_dora` / `pm_alex` / `pm_santa` are the Brazilian Portuguese voices. Combinations like `pf_dora+af_heart` are supported by Kokoro. |
| `KOKORO_TTS_MODEL` | `kokoro` | Model name sent in the request. |
| `KOKORO_TTS_SPEED` | `1` | Speaking speed multiplier (`0.25`–`4`). |
| `KOKORO_TTS_SHORTCUT` | `ctrl+super+s` (macOS), `ctrl+alt+s` (other) | Shortcut that toggles voice mode. On macOS, `super` is the Cmd key. |

## Notes

- Markdown is stripped before synthesis: code blocks, links, headings, and URLs are removed or simplified so the speech sounds natural.
- Responses are truncated to 4000 characters per utterance.
- Requires interactive (TUI) mode for the shortcut and footer status.
