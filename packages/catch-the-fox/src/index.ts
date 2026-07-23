import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  CHARACTER_IDS,
  CHARACTERS,
  isCharacterId,
  type CharacterId,
} from "./characters.js";
import { ANIMS, type FoxState } from "./fox-art.js";
import { FoxWidget } from "./fox-widget.js";
import {
  DEFAULT_FOX_PREFERENCES,
  loadFoxPreferences,
  saveFoxPreferences,
  type FoxPreferences,
} from "./preferences.js";
import {
  isSpriteSize,
  SPRITE_SIZE_IDS,
  type SpriteSize,
} from "./sprite-size.js";

export { CHARACTER_IDS, CHARACTERS } from "./characters.js";
export { orientFoxGrid } from "./fox-run-motion.js";
export { gridToAnsi } from "./fox-widget.js";
export { SwimJourney } from "./swim-journey.js";
export {
  scaleGrid,
  scaleGridToDimensions,
  SPRITE_SIZE_IDS,
  SPRITE_SIZES,
} from "./sprite-size.js";

function stateForTool(toolName: string): FoxState {
  const normalizedToolName = toolName.toLowerCase();
  if (/(read|grep|glob|find|search|ffgrep|list)/.test(normalizedToolName)) {
    return "sniff";
  }
  if (/(edit|write|patch|replace)/.test(normalizedToolName)) {
    return "dig";
  }
  if (/(bash|shell|exec|fetch|web|browser|curl)/.test(normalizedToolName)) {
    return "run";
  }
  return "sniff";
}

function configuredCharacter(value: unknown): CharacterId | undefined {
  if (typeof value !== "string") return undefined;
  const character = value.toLowerCase();
  return isCharacterId(character) ? character : undefined;
}

function configuredSize(value: unknown): SpriteSize | undefined {
  if (typeof value !== "string") return undefined;
  const size = value.toLowerCase();
  return isSpriteSize(size) ? size : undefined;
}

export interface FoxPreferenceStore {
  load(): Promise<FoxPreferences>;
  save(preferences: FoxPreferences): Promise<void>;
}

const defaultPreferenceStore: FoxPreferenceStore = {
  load: loadFoxPreferences,
  save: saveFoxPreferences,
};

export default function catchTheFoxExtension(
  pi: ExtensionAPI,
  preferenceStore: FoxPreferenceStore = defaultPreferenceStore,
): void {
  pi.registerFlag("fox-reduced-motion", {
    description: "Mantém a personagem estática, sem animações contínuas",
    type: "boolean",
    default: false,
  });
  pi.registerFlag("fox-character", {
    description: `Personagem do widget: ${CHARACTER_IDS.join(" ou ")}`,
    type: "string",
  });
  pi.registerFlag("fox-size", {
    description: `Tamanho do widget: ${SPRITE_SIZE_IDS.join(", ")}`,
    type: "string",
  });

  const configuredCharacterFlag = configuredCharacter(
    pi.getFlag("fox-character"),
  );
  const configuredSizeFlag = configuredSize(pi.getFlag("fox-size"));
  const fox = new FoxWidget(
    pi.getFlag("fox-reduced-motion") === true,
    configuredCharacterFlag ?? DEFAULT_FOX_PREFERENCES.character,
    configuredSizeFlag ?? DEFAULT_FOX_PREFERENCES.size,
  );
  let persistedPreferences = { ...DEFAULT_FOX_PREFERENCES };
  let errorStreak = 0;

  const persistPreferences = async (
    context: { ui: { notify(message: string, level: "warning"): void } },
  ): Promise<boolean> => {
    try {
      await preferenceStore.save({ ...persistedPreferences });
      return true;
    } catch {
      context.ui.notify(
        "Preferência aplicada nesta sessão, mas não foi possível salvá-la",
        "warning",
      );
      return false;
    }
  };

  pi.on("session_start", async (_event, context) => {
    persistedPreferences = await preferenceStore.load();
    fox.setCharacter(
      configuredCharacterFlag ?? persistedPreferences.character,
    );
    fox.setSize(configuredSizeFlag ?? persistedPreferences.size);
    fox.setUI(context.ui);
    fox.setState("sleep");
  });

  pi.on("agent_start", async (_event, context) => {
    fox.setUI(context.ui);
    errorStreak = 0;
    fox.setState("sniff");
  });

  pi.on("tool_execution_start", async (event: any, context: any) => {
    fox.setUI(context.ui);
    fox.setState(stateForTool(event.toolName ?? ""));
  });

  pi.on("tool_result", async (event: any, context: any) => {
    fox.setUI(context.ui);
    if (event.isError) {
      errorStreak += 1;
      fox.setState(errorStreak >= 3 ? "sad" : "error");
    } else {
      errorStreak = 0;
    }
  });

  pi.on("agent_end", async (_event, context) => {
    fox.setUI(context.ui);
    if (errorStreak >= 3) {
      fox.setState("sad");
      return;
    }
    fox.completeTurn();
  });

  pi.on("session_shutdown", async () => {
    fox.shutdown();
  });

  pi.registerCommand("fox", {
    description:
      "Controla a personagem: /fox <estado|hide|show|size <large|medium|small>|character <fox|capybara|warrior>|characters>",
    handler: async (args, context) => {
      if (!context.hasUI) {
        context.ui.notify("/fox requer modo interativo", "error");
        return;
      }
      fox.setUI(context.ui);
      const [command = "", value = ""] = (args ?? "")
        .trim()
        .toLowerCase()
        .split(/\s+/);
      if (command === "hide") {
        fox.hide();
        context.ui.notify(
          `${CHARACTERS[fox.getCharacter()].name} escondida (/fox show pra voltar)`,
          "info",
        );
        return;
      }
      if (command === "show") {
        fox.show();
        context.ui.notify(
          `${CHARACTERS[fox.getCharacter()].name} on!`,
          "info",
        );
        return;
      }
      if (command === "size") {
        if (!isSpriteSize(value)) {
          context.ui.notify(
            `Tamanhos: ${SPRITE_SIZE_IDS.join(", ")}`,
            "warning",
          );
          return;
        }
        fox.setSize(value);
        persistedPreferences = { ...persistedPreferences, size: value };
        if (await persistPreferences(context)) {
          context.ui.notify(`Tamanho salvo: ${value}`, "info");
        }
        return;
      }
      if (command === "character" || command === "characters") {
        if (!value) {
          const currentIndex = CHARACTER_IDS.indexOf(fox.getCharacter());
          const nextCharacter =
            CHARACTER_IDS[(currentIndex + 1) % CHARACTER_IDS.length];
          fox.setCharacter(nextCharacter);
          persistedPreferences = {
            ...persistedPreferences,
            character: nextCharacter,
          };
          if (await persistPreferences(context)) {
            context.ui.notify(
              `Personagem salva: ${CHARACTERS[nextCharacter].name}`,
              "info",
            );
          }
          return;
        }
        if (!isCharacterId(value)) {
          context.ui.notify(
            `Personagens: ${CHARACTER_IDS.join(", ")}`,
            "warning",
          );
          return;
        }
        fox.setCharacter(value);
        persistedPreferences = { ...persistedPreferences, character: value };
        if (await persistPreferences(context)) {
          context.ui.notify(
            `Personagem salva: ${CHARACTERS[value].name}`,
            "info",
          );
        }
        return;
      }
      if (command && command in ANIMS) {
        fox.showState(command as FoxState);
        return;
      }
      context.ui.notify(
        `Personagem: ${fox.getCharacter()} · tamanho: ${fox.getSize()} · estados: ${Object.keys(ANIMS).join(", ")} · /fox characters troca de personagem · hide · show`,
        "info",
      );
    },
  });
}
