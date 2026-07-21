import {
  CAPYBARA_HEIGHT,
  CAPYBARA_PALETTE,
  CAPYBARA_SOURCE,
  CAPYBARA_WIDTH,
  type CapybaraSourceAnimation,
} from "./capybara-art.js";
import {
  ANIMS as FOX_ANIMS,
  PALETTE as FOX_PALETTE,
  type FoxAnimation,
  type FoxState,
  type RGB,
} from "./fox-art.js";
import {
  SPRITE_SIZES,
  type SpriteDimensions,
  type SpriteSize,
} from "./sprite-size.js";

export type CharacterId = "fox" | "capybara";
export type CharacterFacing = "left" | "right";

export interface CharacterDefinition {
  animations: Record<FoxState, FoxAnimation>;
  id: CharacterId;
  name: string;
  palette: Record<string, RGB>;
  sourceFacing: CharacterFacing;
  spriteDimensions: Record<SpriteSize, SpriteDimensions>;
}

function animationDuration(animation: CapybaraSourceAnimation): number {
  return animation.durationsMs.reduce(
    (total, duration) => total + duration,
    0,
  );
}

function sourcedAnimation(
  source: CapybaraSourceAnimation,
  label: string,
  options: Pick<FoxAnimation, "holdLastFrame" | "once"> = {},
): FoxAnimation {
  return {
    label,
    intervalMs: source.durationsMs[0] ?? 100,
    frameDurationsMs: source.durationsMs,
    grids: source.grids,
    ...options,
  };
}

const capybaraDigGrids = [
  ...CAPYBARA_SOURCE.crouch.grids,
  ...CAPYBARA_SOURCE.attackOne.grids,
];
const capybaraDigDurations = [
  ...CAPYBARA_SOURCE.crouch.durationsMs,
  ...CAPYBARA_SOURCE.attackOne.durationsMs,
];
const capybaraJumpGrids = [
  ...CAPYBARA_SOURCE.jump.grids,
  ...CAPYBARA_SOURCE.jumpSolo.grids,
];
const capybaraJumpDurations = [
  ...CAPYBARA_SOURCE.jump.durationsMs,
  ...CAPYBARA_SOURCE.jumpSolo.durationsMs,
];

const CAPYBARA_ANIMS: Record<FoxState, FoxAnimation> = {
  sleep: sourcedAnimation(
    CAPYBARA_SOURCE.breathe,
    "respirando sem pressa…",
  ),
  sniff: sourcedAnimation(
    CAPYBARA_SOURCE.walk,
    "passeando pelo código",
  ),
  dig: {
    label: "cavando com os dentinhos",
    intervalMs: capybaraDigDurations[0] ?? 100,
    frameDurationsMs: capybaraDigDurations,
    grids: capybaraDigGrids,
  },
  run: sourcedAnimation(
    CAPYBARA_SOURCE.run,
    "capivarando atrás",
  ),
  jump: {
    label: "saltando a burocracia!",
    intervalMs: capybaraJumpDurations[0] ?? 100,
    frameDurationsMs: capybaraJumpDurations,
    grids: capybaraJumpGrids,
  },
  caught: sourcedAnimation(
    CAPYBARA_SOURCE.attackTwo,
    "capivou!",
    { once: { durationMs: animationDuration(CAPYBARA_SOURCE.attackTwo), then: "sleep" } },
  ),
  error: sourcedAnimation(
    CAPYBARA_SOURCE.hurt,
    "ai! beliscou o código",
    { once: { durationMs: 420, then: "sleep" } },
  ),
  sad: sourcedAnimation(
    CAPYBARA_SOURCE.die,
    "vou deitar um pouquinho…",
    { holdLastFrame: true },
  ),
  swim: sourcedAnimation(
    CAPYBARA_SOURCE.swim,
    "nadando no código",
  ),
};

const CAPYBARA_DIMENSIONS: Record<SpriteSize, SpriteDimensions> = {
  large: { width: CAPYBARA_WIDTH, height: CAPYBARA_HEIGHT },
  medium: { width: 20, height: 18 },
  small: { width: 13, height: 12 },
};

export const CHARACTERS: Record<CharacterId, CharacterDefinition> = {
  fox: {
    id: "fox",
    name: "raposa",
    animations: FOX_ANIMS,
    palette: FOX_PALETTE,
    sourceFacing: "left",
    spriteDimensions: SPRITE_SIZES,
  },
  capybara: {
    id: "capybara",
    name: "capivara",
    animations: CAPYBARA_ANIMS,
    palette: { ...FOX_PALETTE, ...CAPYBARA_PALETTE },
    sourceFacing: "right",
    spriteDimensions: CAPYBARA_DIMENSIONS,
  },
};

export const CHARACTER_IDS = Object.keys(CHARACTERS) as CharacterId[];

export function isCharacterId(value: string): value is CharacterId {
  return CHARACTER_IDS.includes(value as CharacterId);
}
