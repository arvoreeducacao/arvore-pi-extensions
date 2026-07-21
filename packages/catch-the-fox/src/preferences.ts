import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  isCharacterId,
  type CharacterId,
} from "./characters.js";
import { isSpriteSize, type SpriteSize } from "./sprite-size.js";

export interface FoxPreferences {
  character: CharacterId;
  size: SpriteSize;
}

export const DEFAULT_FOX_PREFERENCES: FoxPreferences = {
  character: "fox",
  size: "large",
};

export function foxPreferencesPath(): string {
  return join(homedir(), ".config", "pi", "catch-the-fox.json");
}

export async function loadFoxPreferences(
  filePath = foxPreferencesPath(),
): Promise<FoxPreferences> {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as {
      character?: unknown;
      size?: unknown;
    };
    return {
      character:
        typeof raw.character === "string" && isCharacterId(raw.character)
          ? raw.character
          : DEFAULT_FOX_PREFERENCES.character,
      size:
        typeof raw.size === "string" && isSpriteSize(raw.size)
          ? raw.size
          : DEFAULT_FOX_PREFERENCES.size,
    };
  } catch {
    return { ...DEFAULT_FOX_PREFERENCES };
  }
}

export async function saveFoxPreferences(
  preferences: FoxPreferences,
  filePath = foxPreferencesPath(),
): Promise<void> {
  const directory = dirname(filePath);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    temporaryPath,
    `${JSON.stringify(preferences, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await rename(temporaryPath, filePath);
}
