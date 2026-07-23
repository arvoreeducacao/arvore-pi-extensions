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
import {
  WARRIOR_HEIGHT,
  WARRIOR_PALETTE,
  WARRIOR_SOURCE,
  WARRIOR_WIDTH,
  type WarriorSourceAnimation,
} from "./warrior-art.js";

export type CharacterId = "fox" | "capybara" | "warrior";
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

function warriorAnimation(
  source: WarriorSourceAnimation,
  label: string,
  options: Pick<FoxAnimation, "holdLastFrame" | "motion" | "once"> = {},
): FoxAnimation {
  return {
    label,
    intervalMs: source.durationsMs[0] ?? 100,
    frameDurationsMs: source.durationsMs,
    grids: source.grids,
    ...options,
  };
}

function warriorAnimationDuration(source: WarriorSourceAnimation): number {
  return source.durationsMs.reduce((total, duration) => total + duration, 0);
}

const WARRIOR_ANIMS: Record<FoxState, FoxAnimation> = {
  sleep: warriorAnimation(WARRIOR_SOURCE.idle, "descansando a espada…"),
  sniff: warriorAnimation(WARRIOR_SOURCE.walk, "patrulhando o código", {
    motion: "patrol",
  }),
  dig: warriorAnimation(WARRIOR_SOURCE.slash, "cortando o problema"),
  run: warriorAnimation(WARRIOR_SOURCE.run, "investindo atrás"),
  jump: warriorAnimation(WARRIOR_SOURCE.dash, "avançando com tudo!"),
  caught: warriorAnimation(WARRIOR_SOURCE.bigSlash, "golpe final!", {
    once: {
      durationMs: warriorAnimationDuration(WARRIOR_SOURCE.bigSlash),
      then: "sleep",
    },
  }),
  error: warriorAnimation(WARRIOR_SOURCE.hurt, "ai! tomou um contra-ataque", {
    once: { durationMs: 420, then: "sleep" },
  }),
  sad: {
    label: "recuando pra se recompor…",
    intervalMs: 650,
    frameDurationsMs: [650, 650],
    grids: WARRIOR_SOURCE.hurt.grids,
  },
  swim: warriorAnimation(WARRIOR_SOURCE.run, "nadando no código"),
};

const WARRIOR_DIMENSIONS: Record<SpriteSize, SpriteDimensions> = {
  large: { width: WARRIOR_WIDTH, height: WARRIOR_HEIGHT },
  medium: { width: 21, height: 18 },
  small: { width: 14, height: 12 },
};

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
  sniff: {
    ...sourcedAnimation(CAPYBARA_SOURCE.walk, "passeando pelo código"),
    motion: "patrol",
  },
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
  swim: {
    ...sourcedAnimation(CAPYBARA_SOURCE.swim, "nadando no código"),
    motion: "swim-journey",
    journey: {
      walkGrids: CAPYBARA_SOURCE.walk.grids,
      walkDurationsMs: CAPYBARA_SOURCE.walk.durationsMs,
      diveGrids: CAPYBARA_SOURCE.jumpSolo.grids,
      diveDurationsMs: CAPYBARA_SOURCE.jumpSolo.durationsMs,
      swimGrids: CAPYBARA_SOURCE.swim.grids,
      swimDurationsMs: CAPYBARA_SOURCE.swim.durationsMs,
    },
  },
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
  warrior: {
    id: "warrior",
    name: "raposa guerreira",
    animations: WARRIOR_ANIMS,
    palette: WARRIOR_PALETTE,
    sourceFacing: "right",
    spriteDimensions: WARRIOR_DIMENSIONS,
  },
};

export const CHARACTER_IDS = Object.keys(CHARACTERS) as CharacterId[];

export function isCharacterId(value: string): value is CharacterId {
  return CHARACTER_IDS.includes(value as CharacterId);
}
