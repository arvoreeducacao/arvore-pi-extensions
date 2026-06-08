import { spawn } from "node:child_process";

export type AudioInputDevice = {
  id: string;
  label: string;
  isDefault: boolean;
};

const SOURCE_LINE = /^(\*)?\s*(\S.*?)\s*\[([^\]]*)\]\s*(?:\([^)]*\))?\s*$/;

export function listInputDevices(backendFormat: string, signal?: AbortSignal): Promise<AudioInputDevice[]> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-sources", backendFormat], {
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });

    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      output += String(chunk);
    });

    child.on("error", () => resolve([]));
    child.on("close", () => resolve(parseDeviceList(output, backendFormat)));
  });
}

function parseDeviceList(output: string, backendFormat: string): AudioInputDevice[] {
  const devices: AudioInputDevice[] = [];
  const seen = new Set<string>();

  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim() || /Auto-detected sources/i.test(line)) continue;

    const match = SOURCE_LINE.exec(line);
    if (!match) continue;

    const isDefault = match[1] === "*";
    const id = match[2].trim();
    const description = match[3].trim();

    if (!id || seen.has(id)) continue;
    if (isOutputOrMonitor(id, description, backendFormat)) continue;

    seen.add(id);
    devices.push({
      id,
      label: description && description !== id ? `${description} (${id})` : id,
      isDefault,
    });
  }

  return devices;
}

function isOutputOrMonitor(id: string, description: string, backendFormat: string): boolean {
  if (/\.monitor$/i.test(id) || /Monitor of/i.test(description)) return true;
  if (id === "null" || /Discard all samples/i.test(description)) return true;
  if (backendFormat === "alsa" && (id.startsWith("front:") || id === "pipewire")) return true;
  return false;
}
