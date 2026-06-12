import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const STATUS_KEY = "kokoro-tts";
const STATE_ENTRY_TYPE = "kokoro-tts-state";
const SAMPLE_RATE = 24000;
const DEFAULT_BASE_URL = "https://tts.arvore.com.br/v1";
const DEFAULT_VOICE = "pf_dora";
const DEFAULT_MODEL = "kokoro";
const MAX_SPEAK_CHARS = 4000;
const MIN_CHUNK_CHARS = 60;

interface VoiceState {
  enabled: boolean;
  voice?: string;
}

const VOICE_ENTRY_TYPE = "kokoro-tts-voice";

interface ActivePlayback {
  process: ChildProcess;
  controller: AbortController;
}

function resolveBaseUrl(): string {
  const configured = process.env.KOKORO_TTS_URL?.trim();
  return (configured ? configured : DEFAULT_BASE_URL).replace(/\/$/, "");
}

function resolveEnvVoice(): string {
  const configured = process.env.KOKORO_TTS_VOICE?.trim();
  return configured ? configured : DEFAULT_VOICE;
}

function languageLabel(voice: string): string {
  const map: Record<string, string> = {
    pf: "PT feminino",
    pm: "PT masculino",
    af: "EN-US fem",
    am: "EN-US masc",
    bf: "EN-UK fem",
    bm: "EN-UK masc",
    ef: "ES fem",
    em: "ES masc",
    ff: "FR fem",
    hf: "HI fem",
    hm: "HI masc",
    if: "IT fem",
    im: "IT masc",
    jf: "JP fem",
    jm: "JP masc",
    zf: "ZH fem",
    zm: "ZH masc",
  };
  return map[voice.slice(0, 2)] ?? "outro";
}

const ALLOWED_VOICE_PREFIXES = ["pf", "pm", "af", "am"];

function sortVoices(voices: string[]): string[] {
  const rank = (v: string): number => {
    if (v.startsWith("pf") || v.startsWith("pm")) return 0;
    return 1;
  };
  return voices
    .filter((v) => ALLOWED_VOICE_PREFIXES.includes(v.slice(0, 2)))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

async function fetchVoices(): Promise<string[]> {
  const baseUrl = resolveBaseUrl();
  const apiKey = resolveApiKey();
  const headers: Record<string, string> = {};
  if (apiKey) headers["x-api-key"] = apiKey;
  const response = await fetch(`${baseUrl}/audio/voices`, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as { voices?: unknown };
  const voices = Array.isArray(data.voices) ? data.voices.filter((v): v is string => typeof v === "string") : [];
  return voices;
}

function resolveApiKey(): string | undefined {
  const key = process.env.KOKORO_TTS_API_KEY?.trim() || process.env.ARVORE_TTS_API_KEY?.trim();
  return key ? key : undefined;
}

function resolveModel(): string {
  const configured = process.env.KOKORO_TTS_MODEL?.trim();
  return configured ? configured : DEFAULT_MODEL;
}

function resolveSpeed(): number {
  const raw = Number.parseFloat(process.env.KOKORO_TTS_SPEED ?? "");
  if (Number.isFinite(raw) && raw >= 0.25 && raw <= 4) return raw;
  return 1;
}

function resolveStreaming(): boolean {
  const raw = process.env.KOKORO_TTS_STREAMING?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  return true;
}

function hasBinary(binary: string): boolean {
  return spawnSync("which", [binary], { stdio: "ignore" }).status === 0;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function extractText(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join(" ").trim();
}

function sanitizeForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_~>#|]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSpeakable(buffer: string): { chunks: string[]; rest: string } {
  const chunks: string[] = [];
  let rest = buffer;
  const boundary = /[.!?…:;\n]+\s/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  while ((match = boundary.exec(rest)) !== null) {
    const end = match.index + match[0].length;
    const candidate = rest.slice(lastIndex, end).trim();
    if (candidate.length >= MIN_CHUNK_CHARS) {
      chunks.push(candidate);
      lastIndex = end;
    }
  }
  rest = rest.slice(lastIndex);
  return { chunks, rest };
}

export default function kokoroTts(pi: ExtensionAPI): void {
  let state: VoiceState = { enabled: false };
  let lastSpoken: string | null = null;
  let playback: ActivePlayback | null = null;

  const streamingEnabled = resolveStreaming();
  let liveBuffer = "";
  let liveActive = false;
  let pending = "";
  let queue: Promise<void> = Promise.resolve();
  let speakGeneration = 0;

  pi.on("session_start", async (_event, ctx) => {
    state = restoreState(ctx);
    refreshStatus(ctx);
  });

  pi.on("session_shutdown", async () => {
    stopPlayback();
  });

  pi.registerCommand("voice", {
    description: "Toggle Kokoro voice mode (speak assistant responses out loud)",
    handler: async (_args, ctx) => {
      state = { ...state, enabled: !state.enabled };
      persistState(pi, state);
      refreshStatus(ctx);
      if (!state.enabled) {
        interrupt();
        ctx.ui.notify("Voice mode off.", "info");
      } else {
        ctx.ui.notify("Voice mode on — responses will be spoken.", "info");
      }
    },
  });

  pi.registerCommand("voice-select", {
    description: "Choose the Kokoro TTS voice",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("voice-select requires interactive mode", "error");
        return;
      }
      let voices: string[];
      try {
        voices = await fetchVoices();
      } catch (error) {
        ctx.ui.notify(`Failed to list voices: ${describe(error)}`, "error");
        return;
      }
      if (voices.length === 0) {
        ctx.ui.notify("No voices returned by the endpoint.", "warning");
        return;
      }
      const current = state.voice ?? resolveEnvVoice();
      const sorted = sortVoices(voices);
      const items = sorted.map((v) => {
        const active = v === current ? "  \u2713" : "";
        return `${v}  (${languageLabel(v)})${active}`;
      });
      const choice = await ctx.ui.select("Select voice", items);
      if (choice === undefined) return;
      const index = items.indexOf(choice);
      const voice = sorted[index];
      if (!voice) return;
      state = { ...state, voice };
      persistState(pi, state);
      interrupt();
      ctx.ui.notify(`Voice set to ${voice}.`, "info");
      enqueueSpeak("Pronto, essa \u00e9 a nova voz.", ctx);
    },
  });

  pi.registerCommand("say", {
    description: "Speak arbitrary text (or the last response) via Kokoro TTS",
    handler: async (args, ctx) => {
      const text = args.trim() ? args.trim() : lastSpoken;
      if (!text) {
        ctx.ui.notify("Nothing to say. Provide text or wait for a response.", "info");
        return;
      }
      interrupt();
      enqueueSpeak(text, ctx);
    },
  });

  pi.registerCommand("tts-stop", {
    description: "Stop the current Kokoro TTS playback",
    handler: async (_args, ctx) => {
      interrupt();
      ctx.ui.notify("Playback stopped.", "info");
    },
  });

  pi.on("message_start", async (event, _ctx) => {
    const message = (event as { message?: unknown }).message;
    const role = (message as { role?: string })?.role;
    if (role === "user") {
      interrupt();
      return;
    }
    if (!state.enabled || !streamingEnabled) return;
    if (role !== "assistant") return;
    resetLive();
    liveActive = true;
  });

  pi.on("message_update", async (event, ctx) => {
    if (!state.enabled || !streamingEnabled || !liveActive) return;
    const message = (event as { message?: unknown }).message;
    if ((message as { role?: string })?.role !== "assistant") return;
    const full = extractText(message);
    if (full.length <= liveBuffer.length) return;
    const delta = full.slice(liveBuffer.length);
    liveBuffer = full;
    pending += delta;
    const { chunks, rest } = splitSpeakable(pending);
    pending = rest;
    for (const chunk of chunks) {
      const clean = sanitizeForSpeech(chunk);
      if (clean) enqueueSpeak(clean, ctx);
    }
  });

  pi.on("message_end", async (event, ctx) => {
    if (!state.enabled) return;
    const message = (event as { message?: unknown }).message;
    if ((message as { role?: string })?.role !== "assistant") return;

    const full = sanitizeForSpeech(extractText(message));
    if (full) lastSpoken = full;

    if (streamingEnabled && liveActive) {
      const tail = sanitizeForSpeech(pending);
      resetLive();
      if (tail) enqueueSpeak(tail, ctx);
      return;
    }

    if (!full) return;
    stopPlayback();
    enqueueSpeak(full, ctx);
  });

  function resetLive(): void {
    liveActive = false;
    liveBuffer = "";
    pending = "";
  }

  function refreshStatus(ctx: ExtensionContext): void {
    if (state.enabled) {
      ctx.ui.setStatus(STATUS_KEY, "🔊 voice on — /voice to toggle");
    } else {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  }

  function stopPlayback(): void {
    const active = playback;
    if (!active) return;
    playback = null;
    active.controller.abort();
    const child = active.process;
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }

  function interrupt(): void {
    speakGeneration += 1;
    queue = Promise.resolve();
    resetLive();
    stopPlayback();
  }

  function enqueueSpeak(text: string, ctx: ExtensionContext): void {
    const generation = speakGeneration;
    queue = queue
      .then(() => {
        if (generation !== speakGeneration) return;
        return speak(text, ctx);
      })
      .catch(() => undefined);
  }

  async function speak(rawText: string, ctx: ExtensionContext): Promise<void> {
    if (!hasBinary("ffplay")) {
      ctx.ui.notify("ffplay not found — install ffmpeg to use Kokoro TTS", "error");
      return;
    }

    const text = truncate(rawText, MAX_SPEAK_CHARS);
    if (!text) return;

    const controller = new AbortController();
    const baseUrl = resolveBaseUrl();
    const apiKey = resolveApiKey();

    ctx.ui.setStatus(STATUS_KEY, "🔊 speaking…");

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (apiKey) headers["x-api-key"] = apiKey;

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/audio/speech`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: resolveModel(),
          input: text,
          voice: state.voice ?? resolveEnvVoice(),
          response_format: "pcm",
          speed: resolveSpeed(),
          stream: true,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      ctx.ui.notify(`Kokoro request failed: ${describe(error)}`, "error");
      refreshStatus(ctx);
      return;
    }

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      ctx.ui.notify(
        `Kokoro HTTP ${response.status}${detail ? ` — ${truncate(detail, 200)}` : ""}`,
        "error",
      );
      refreshStatus(ctx);
      return;
    }

    const child = spawn(
      "ffplay",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nodisp",
        "-autoexit",
        "-f",
        "s16le",
        "-ar",
        String(SAMPLE_RATE),
        "-ch_layout",
        "mono",
        "-i",
        "pipe:0",
      ],
      { stdio: ["pipe", "ignore", "ignore"] },
    );

    const active: ActivePlayback = { process: child, controller };
    playback = active;

    child.stdin?.on("error", () => {
      controller.abort();
    });

    child.on("error", () => {
      if (playback === active) {
        playback = null;
        controller.abort();
        ctx.ui.notify("ffplay failed to start", "error");
        refreshStatus(ctx);
      }
    });

    await new Promise<void>((resolve) => {
      child.once("exit", () => {
        if (playback === active) {
          playback = null;
          refreshStatus(ctx);
        }
        resolve();
      });

      void pump(response, child, active, controller, ctx).then(() => {
        try {
          if (child.stdin && !child.stdin.destroyed) child.stdin.end();
        } catch {
          // ignore
        }
      });
    });
  }

  async function pump(
    response: Response,
    child: ChildProcess,
    active: ActivePlayback,
    controller: AbortController,
    ctx: ExtensionContext,
  ): Promise<void> {
    try {
      const reader = response.body!.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (playback !== active || controller.signal.aborted) break;
        const stdin = child.stdin;
        if (!value || !stdin || stdin.destroyed || !stdin.writable) break;
        try {
          if (!stdin.write(value)) {
            await new Promise<void>((resolve) => {
              const done = () => resolve();
              stdin.once("drain", done);
              stdin.once("error", done);
              stdin.once("close", done);
            });
          }
        } catch {
          break;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        ctx.ui.notify(`Kokoro stream error: ${describe(error)}`, "error");
      }
    }
  }
}

function persistState(pi: ExtensionAPI, state: VoiceState): void {
  pi.appendEntry(STATE_ENTRY_TYPE, state);
}

function restoreState(ctx: ExtensionContext): VoiceState {
  let result: VoiceState = { enabled: false };
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;
    const data = entry.data as { enabled?: unknown; voice?: unknown } | null;
    result = {
      enabled: data?.enabled === true,
      voice: typeof data?.voice === "string" ? data.voice : undefined,
    };
  }
  return result;
}
