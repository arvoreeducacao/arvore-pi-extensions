import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const FRAME_SIZE = 100;
const TARGET_WIDTH = 24;
const TARGET_HEIGHT = 20;
const OUTPUT_PATH = new URL("../src/capybara-art.ts", import.meta.url);
const sourceArgument = process.argv.slice(2).find((argument) => argument !== "--");
if (!sourceArgument) {
  throw new Error(
    "Uso: pnpm import:capybara -- /caminho/para/8 bit Capibaras/Capibara",
  );
}
const SOURCE_DIR = path.resolve(sourceArgument);

const animations = [
  {
    id: "breathe",
    sheet: "Capi naranja respirando-Sheet.png",
    aseprite: "Capi naranja respirando.aseprite",
  },
  {
    id: "walk",
    sheet: "CAPI caminando 1-Sheet.png",
    aseprite: "CAPI caminando 1.aseprite",
  },
  {
    id: "swim",
    sheet: "CAPI nadando 1-Sheet.png",
    aseprite: "CAPI nadando 1.aseprite",
  },
  {
    id: "crouch",
    sheet: "capi agachando-Sheet.png",
    aseprite: "capi agachando.aseprite",
  },
  {
    id: "attackOne",
    sheet: "capi ataque 1-Sheet.png",
    aseprite: "capi ataque 1.aseprite",
  },
  {
    id: "attackTwo",
    sheet: "capi ataque 2-Sheet.png",
    aseprite: "capi ataque 2.aseprite",
  },
  {
    id: "run",
    sheet: "capi corriendo 1-Sheet.png",
    aseprite: "capi corriendo 1.aseprite",
  },
  {
    id: "hurt",
    sheet: "capi daño-Sheet.png",
    aseprite: "capi daño.aseprite",
  },
  {
    id: "die",
    sheet: "capi muere-Sheet.png",
    aseprite: "capi muere.aseprite",
  },
  {
    id: "jump",
    sheet: "capi saltando 1-Sheet.png",
    aseprite: "capi saltando 1.aseprite",
  },
  {
    id: "jumpSolo",
    sheet: "capi saltando solo-Sheet.png",
    aseprite: "capi saltando solo.aseprite",
  },
];

function readDurations(buffer) {
  if (buffer.readUInt16LE(4) !== 0xa5e0) {
    throw new Error("Arquivo .aseprite inválido");
  }
  const frameCount = buffer.readUInt16LE(6);
  const durations = [];
  let offset = 128;
  for (let frame = 0; frame < frameCount; frame += 1) {
    if (buffer.readUInt16LE(offset + 4) !== 0xf1fa) {
      throw new Error(`Frame ${frame} inválido no arquivo .aseprite`);
    }
    durations.push(buffer.readUInt16LE(offset + 8));
    offset += buffer.readUInt32LE(offset);
  }
  return durations;
}

function alphaBounds(frame, ignoredColors = new Set()) {
  let left = FRAME_SIZE;
  let top = FRAME_SIZE;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < FRAME_SIZE; y += 1) {
    for (let x = 0; x < FRAME_SIZE; x += 1) {
      const index = (y * FRAME_SIZE + x) * 4;
      if (frame[index + 3] === 0) continue;
      const rgb = `${frame[index]},${frame[index + 1]},${frame[index + 2]}`;
      if (ignoredColors.has(rgb)) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  if (right === 0 || bottom === 0) {
    throw new Error("Quadro sem pixels visíveis");
  }
  const padding = 1;
  return {
    left: Math.max(0, left - padding),
    top: Math.max(0, top - padding),
    right: Math.min(FRAME_SIZE, right + padding),
    bottom: Math.min(FRAME_SIZE, bottom + padding),
  };
}

function pixelKey(frame, x, y) {
  const index = (y * FRAME_SIZE + x) * 4;
  if (frame[index + 3] === 0) return undefined;
  return `${frame[index]},${frame[index + 1]},${frame[index + 2]}`;
}

function sampledColor(
  frame,
  bounds,
  targetX,
  targetY,
  width,
  height,
  allowedColors,
  excludedColors,
) {
  const sourceWidth = bounds.right - bounds.left;
  const sourceHeight = bounds.bottom - bounds.top;
  const left = bounds.left + Math.floor((targetX * sourceWidth) / width);
  const right = bounds.left + Math.max(
    Math.floor((targetX * sourceWidth) / width) + 1,
    Math.ceil(((targetX + 1) * sourceWidth) / width),
  );
  const top = bounds.top + Math.floor((targetY * sourceHeight) / height);
  const bottom = bounds.top + Math.max(
    Math.floor((targetY * sourceHeight) / height) + 1,
    Math.ceil(((targetY + 1) * sourceHeight) / height),
  );
  const colors = [];
  for (let y = top; y < Math.min(bounds.bottom, bottom); y += 1) {
    for (let x = left; x < Math.min(bounds.right, right); x += 1) {
      const color = pixelKey(frame, x, y);
      if (
        color &&
        !excludedColors.has(color) &&
        (!allowedColors || allowedColors.has(color))
      ) {
        colors.push(color);
      }
    }
  }
  if (colors.length === 0) return undefined;
  const counts = new Map();
  for (const color of colors) counts.set(color, (counts.get(color) ?? 0) + 1);
  return [...counts].sort(([leftColor, leftCount], [rightColor, rightCount]) => {
    if (leftCount !== rightCount) return rightCount - leftCount;
    const leftLuma = leftColor.split(",").map(Number).reduce((total, value) => total + value, 0);
    const rightLuma = rightColor.split(",").map(Number).reduce((total, value) => total + value, 0);
    return leftLuma - rightLuma;
  })[0]?.[0];
}

function sampleFrame(
  frame,
  bounds,
  palette,
  {
    allowedColors,
    excludedColors = new Set(),
    maximumHeight = TARGET_HEIGHT,
    lift = 0,
  } = {},
) {
  const sourceWidth = bounds.right - bounds.left;
  const sourceHeight = bounds.bottom - bounds.top;
  const scale = Math.min(TARGET_WIDTH / sourceWidth, maximumHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const offsetX = Math.floor((TARGET_WIDTH - width) / 2);
  const offsetY = Math.max(0, TARGET_HEIGHT - height - Math.round(lift * scale));
  const rows = Array.from({ length: TARGET_HEIGHT }, () =>
    Array.from({ length: TARGET_WIDTH }, () => "."),
  );

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const rgb = sampledColor(
        frame,
        bounds,
        x,
        y,
        width,
        height,
        allowedColors,
        excludedColors,
      );
      if (rgb) rows[offsetY + y][offsetX + x] = palette.get(rgb);
    }
  }
  return rows.map((row) => row.join(""));
}

function compositeGrids(background, foreground) {
  return background.map((row, y) =>
    [...row]
      .map((pixel, x) => foreground[y]?.[x] === "." ? pixel : foreground[y][x])
      .join(""),
  );
}

function sourceLiteral(id, durations, grids) {
  const gridText = grids
    .map((grid) => `    [\n${grid.map((row) => `      "${row}",`).join("\n")}\n    ],`)
    .join("\n");
  return `  ${id}: {\n    durationsMs: [${durations.join(", ")}],\n    grids: [\n${gridText}\n    ],\n  },`;
}

const rawAnimations = [];
const colors = new Set();
for (const animation of animations) {
  const sheetPath = path.join(SOURCE_DIR, animation.sheet);
  const image = sharp(sheetPath);
  const metadata = await image.metadata();
  if (metadata.height !== FRAME_SIZE || metadata.width % FRAME_SIZE !== 0) {
    throw new Error(`${animation.sheet} não usa quadros de 100×100`);
  }
  const { data, info } = await image.raw().ensureAlpha().toBuffer({
    resolveWithObject: true,
  });
  const frames = [];
  for (let frameIndex = 0; frameIndex < info.width / FRAME_SIZE; frameIndex += 1) {
    const frame = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * 4);
    for (let y = 0; y < FRAME_SIZE; y += 1) {
      const sourceStart = (y * info.width + frameIndex * FRAME_SIZE) * 4;
      data.copy(
        frame,
        y * FRAME_SIZE * 4,
        sourceStart,
        sourceStart + FRAME_SIZE * 4,
      );
    }
    for (let index = 0; index < frame.length; index += 4) {
      if (frame[index + 3] > 0) {
        colors.add(`${frame[index]},${frame[index + 1]},${frame[index + 2]}`);
      }
    }
    frames.push(frame);
  }
  const durations = readDurations(
    await readFile(path.join(SOURCE_DIR, animation.aseprite)),
  );
  if (durations.length !== frames.length) {
    throw new Error(`${animation.id} tem tempos e quadros incompatíveis`);
  }
  rawAnimations.push({ ...animation, durations, frames });
}

const SWIM_BACKGROUND_COLORS = new Set([
  "96,170,204",
  "99,205,255",
  "103,176,206",
  "111,179,204",
  "116,184,212",
  "119,188,214",
  "120,212,255",
  "127,194,219",
  "130,199,226",
]);

const paletteKeys = "abcdefghijklmnopqrstuvwxyz0123456789";
if (colors.size > paletteKeys.length) throw new Error("Paleta grande demais");
const palette = new Map(
  [...colors]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((rgb, index) => [rgb, paletteKeys[index]]),
);
const paletteEntries = [...palette].map(([rgb, key]) => {
  const [red, green, blue] = rgb.split(",").map(Number);
  return `  ${JSON.stringify(key)}: [${red}, ${green}, ${blue}],`;
});
const animationEntries = rawAnimations.map(({ id, durations, frames }) => {
  const ignoredBoundsColors = id === "swim"
    ? SWIM_BACKGROUND_COLORS
    : new Set();
  const frameBounds = frames.map((frame) =>
    alphaBounds(frame, ignoredBoundsColors),
  );
  const preservesJumpHeight = id === "jump" || id === "jumpSolo";
  const baseline = Math.max(...frameBounds.map(({ bottom }) => bottom));
  const grids = frames.map((frame, index) => {
    const foreground = sampleFrame(frame, frameBounds[index], palette, {
      excludedColors: ignoredBoundsColors,
      maximumHeight: preservesJumpHeight ? TARGET_HEIGHT - 4 : TARGET_HEIGHT,
      lift: preservesJumpHeight ? baseline - frameBounds[index].bottom : 0,
    });
    if (id !== "swim") return foreground;
    const water = sampleFrame(
      frame,
      alphaBounds(frame),
      palette,
      { allowedColors: SWIM_BACKGROUND_COLORS },
    );
    return compositeGrids(water, foreground);
  });
  return sourceLiteral(id, durations, grids);
});
const source = `import type { RGB } from "./fox-art.js";\n\nexport interface CapybaraSourceAnimation {\n  durationsMs: number[];\n  grids: string[][];\n}\n\nexport const CAPYBARA_PALETTE: Record<string, RGB> = {\n${paletteEntries.join("\n")}\n};\n\nexport const CAPYBARA_SOURCE = {\n${animationEntries.join("\n")}\n} satisfies Record<string, CapybaraSourceAnimation>;\n`;
await writeFile(OUTPUT_PATH, source);
process.stdout.write(`${OUTPUT_PATH.pathname}\n`);
