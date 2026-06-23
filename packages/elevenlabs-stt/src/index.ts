import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listInputDevices } from "./devices.js";

const DEFAULT_SHORTCUT: KeyId = process.platform === "darwin" ? "ctrl+alt+r" : "ctrl+alt+t";
const STATUS_KEY = "elevenlabs-stt";
const MODEL_ID = "scribe_v2";
const API_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const MIN_RECORDING_MS = 400;
const DEVICE_ENTRY_TYPE = "elevenlabs-stt-device";
const DEFAULT_DEVICE_LABEL = "System default";

type AudioBackend = {
  format: "pulse" | "alsa" | "avfoundation";
};

type SelectedDevice = {
  id: string;
  label: string;
};

type Recording = {
  process: ChildProcess;
  dir: string;
  file: string;
  startedAt: number;
};

function resolveShortcut(): KeyId {
  const configured = process.env.ELEVENLABS_STT_SHORTCUT?.trim();
  return configured ? (configured as KeyId) : DEFAULT_SHORTCUT;
}

function hasBinary(binary: string): boolean {
  return spawnSync("which", [binary], { stdio: "ignore" }).status === 0;
}

function detectAudioBackend(): AudioBackend | null {
  if (!hasBinary("ffmpeg")) return null;

  if (process.platform === "darwin") {
    return { format: "avfoundation" };
  }

  if (hasBinary("pactl") || hasBinary("pulseaudio") || hasBinary("pipewire")) {
    return { format: "pulse" };
  }

  if (hasBinary("arecord")) {
    return { format: "alsa" };
  }

  return { format: "pulse" };
}

function buildInputArgs(backend: AudioBackend, device: SelectedDevice | null): string[] {
  const input = device?.id ?? defaultInputFor(backend.format);
  return ["-f", backend.format, "-i", input];
}

function defaultInputFor(format: AudioBackend["format"]): string {
  return format === "avfoundation" ? ":default" : "default";
}

export default function elevenlabsStt(pi: ExtensionAPI) {
  const shortcut = resolveShortcut();
  let recording: Recording | null = null;
  let transcribing = false;
  let selectedDevice: SelectedDevice | null = null;

  pi.on("session_start", async (_event, ctx) => {
    selectedDevice = restoreSelectedDevice(ctx);
  });

  pi.registerShortcut(shortcut, {
    description: "Push-to-talk: toggle mic recording and transcribe via ElevenLabs",
    handler: async (ctx) => {
      if (transcribing) {
        ctx.ui.notify("Still transcribing the previous recording…", "info");
        return;
      }

      if (recording) {
        await stopAndTranscribe(ctx);
        return;
      }

      await startRecording(ctx);
    },
  });

  pi.registerCommand("stt-devices", {
    description: "List and select the microphone used for speech-to-text",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("stt-devices requires interactive mode", "error");
        return;
      }

      const backend = detectAudioBackend();
      if (!backend) {
        ctx.ui.notify("ffmpeg not found — install ffmpeg to use speech-to-text", "error");
        return;
      }

      const devices = await listInputDevices(backend.format, ctx.signal);
      if (devices.length === 0) {
        ctx.ui.notify("No microphone input devices found.", "warning");
        return;
      }

      const items: string[] = [];
      const defaultItem = `${DEFAULT_DEVICE_LABEL}${selectedDevice ? "" : "  ✓"}`;
      items.push(defaultItem);
      for (const device of devices) {
        const active = selectedDevice?.id === device.id ? "  ✓" : device.isDefault ? "  (default)" : "";
        items.push(`${device.label}${active}`);
      }

      const choice = await ctx.ui.select("Select microphone", items);
      if (choice === undefined) return;

      if (choice === defaultItem) {
        selectedDevice = null;
        clearSelectedDevice(pi);
        ctx.ui.notify(`Microphone set to ${DEFAULT_DEVICE_LABEL.toLowerCase()}.`, "info");
        return;
      }

      const index = items.indexOf(choice) - 1;
      const device = devices[index];
      if (!device) return;

      selectedDevice = { id: device.id, label: device.label };
      persistSelectedDevice(pi, selectedDevice);
      ctx.ui.notify(`Microphone set to ${device.label}.`, "info");
    },
  });

  pi.registerCommand("stt-device-clear", {
    description: "Reset speech-to-text to the system default microphone",
    handler: async (_args, ctx) => {
      selectedDevice = null;
      clearSelectedDevice(pi);
      ctx.ui.notify(`Microphone reset to ${DEFAULT_DEVICE_LABEL.toLowerCase()}.`, "info");
    },
  });

  pi.on("session_shutdown", async () => {
    if (recording) {
      await abortRecording();
    }
  });

  async function startRecording(ctx: ExtensionContext) {
    if (!process.env.ELEVENLABS_API_KEY) {
      ctx.ui.notify("ELEVENLABS_API_KEY is not set", "error");
      return;
    }

    const backend = detectAudioBackend();
    if (!backend) {
      ctx.ui.notify("ffmpeg not found — install ffmpeg to use speech-to-text", "error");
      return;
    }

    let dir: string;
    try {
      dir = await mkdtemp(join(tmpdir(), "pi-stt-"));
    } catch (error) {
      ctx.ui.notify(`Failed to create temp dir: ${describe(error)}`, "error");
      return;
    }

    const file = join(dir, "capture.wav");
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        ...buildInputArgs(backend, selectedDevice),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-y",
        file,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );

    let spawnError: string | null = null;
    child.on("error", (error) => {
      spawnError = describe(error);
    });

    const started = await waitForSpawn(child);
    if (!started || spawnError) {
      await rm(dir, { recursive: true, force: true });
      ctx.ui.notify(spawnError ? `ffmpeg failed to start: ${spawnError}` : "ffmpeg failed to start", "error");
      return;
    }

    recording = { process: child, dir, file, startedAt: Date.now() };
    const mic = selectedDevice ? ` (${selectedDevice.label})` : "";
    ctx.ui.setStatus(STATUS_KEY, `🎙  recording${mic} — ${shortcut} to stop`);
    ctx.ui.notify(`Recording started. Press ${shortcut} again to transcribe.`, "info");
  }

  async function stopAndTranscribe(ctx: ExtensionContext) {
    const active = recording;
    if (!active) return;
    recording = null;
    transcribing = true;

    ctx.ui.setStatus(STATUS_KEY, "⏳ stopping recording…");
    await stopRecorder(active.process);

    const elapsedMs = Date.now() - active.startedAt;
    if (elapsedMs < MIN_RECORDING_MS) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      ctx.ui.notify("Recording too short, ignored.", "info");
      await rm(active.dir, { recursive: true, force: true });
      transcribing = false;
      return;
    }

    ctx.ui.setStatus(STATUS_KEY, "⏳ transcribing…");
    try {
      const audio = await readFile(active.file);
      const text = await transcribe(audio, ctx.signal);
      if (!text) {
        ctx.ui.notify("No speech detected.", "info");
      } else {
        const current = ctx.ui.getEditorText();
        const needsSpace = current.length > 0 && !/\s$/.test(current);
        ctx.ui.pasteToEditor(needsSpace ? ` ${text}` : text);
        ctx.ui.notify("Transcription inserted.", "info");
      }
    } catch (error) {
      ctx.ui.notify(`Transcription failed: ${describe(error)}`, "error");
    } finally {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      await rm(active.dir, { recursive: true, force: true });
      transcribing = false;
    }
  }

  async function abortRecording() {
    const active = recording;
    if (!active) return;
    recording = null;
    await stopRecorder(active.process);
    await rm(active.dir, { recursive: true, force: true });
  }

  async function transcribe(audio: Buffer, signal?: AbortSignal): Promise<string> {
    const form = new FormData();
    form.append("model_id", MODEL_ID);
    form.append("no_verbatim", "true");
    form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "capture.wav");

    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY as string },
      body: form,
      signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${detail ? ` — ${truncate(detail, 300)}` : ""}`);
    }

    const payload = (await response.json()) as { text?: string };
    return (payload.text ?? "").trim();
  }
}

function waitForSpawn(child: ChildProcess): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    child.once("spawn", () => finish(true));
    child.once("error", () => finish(false));
    setTimeout(() => finish(child.pid !== undefined), 300);
  });
}

function stopRecorder(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    child.once("exit", () => resolve());

    try {
      child.stdin?.write("q");
      child.stdin?.end();
    } catch {
      child.kill("SIGTERM");
    }

    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 2000);
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function persistSelectedDevice(pi: ExtensionAPI, device: SelectedDevice): void {
  pi.appendEntry(DEVICE_ENTRY_TYPE, device);
}

function clearSelectedDevice(pi: ExtensionAPI): void {
  pi.appendEntry(DEVICE_ENTRY_TYPE, null);
}

function restoreSelectedDevice(ctx: ExtensionContext): SelectedDevice | null {
  let result: SelectedDevice | null = null;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "custom" || entry.customType !== DEVICE_ENTRY_TYPE) continue;
    const data = entry.data as SelectedDevice | null | undefined;
    result = data && typeof data.id === "string" ? { id: data.id, label: data.label ?? data.id } : null;
  }
  return result;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
