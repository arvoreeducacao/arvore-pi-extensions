import path from "node:path";
import process from "node:process";
import {
  CHARACTER_IDS,
  CHARACTERS,
  gridToAnsi,
  scaleGrid,
  SPRITE_SIZE_IDS,
  SPRITE_SIZES,
} from "./dist/index.js";
import { FOX_STATES } from "./dist/fox-art.js";
import {
  FoxRunMotion,
  renderRunGrid,
} from "./dist/fox-run-motion.js";

const ESC = "\x1b[";
const stateNotes = {
  sniff: "pi lendo ou buscando arquivos",
  dig: "pi editando código",
  run: "pi executando shell ou web",
  error: "uma ferramenta falhou",
  jump: "turno concluído",
  caught: "resultado capturado",
  sad: "três erros seguidos",
  swim: "atravessando águas profundas",
  sleep: "ocioso, esperando você",
};

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function argumentValue(name) {
  const argumentIndex = process.argv.indexOf(name);
  return argumentIndex === -1 ? undefined : process.argv[argumentIndex + 1];
}

function assertChoice(value, choices, label) {
  if (!value || !choices.includes(value)) {
    throw new Error(`${label} inválido. Use: ${choices.join(", ")}`);
  }
  return value;
}

function createFrame(character, size, state, frameIndex, terminalWidth, runMotion) {
  const animation = CHARACTERS[character].animations[state];
  let grid = scaleGrid(
    animation.grids[frameIndex % animation.grids.length],
    size,
  );
  let offset = 0;
  if (state === "run") {
    const placement = runMotion.snapshot(terminalWidth);
    grid = renderRunGrid(
      grid,
      placement,
      CHARACTERS[character].sourceFacing,
    );
    offset = placement.offset;
  }
  return {
    animation,
    lines: gridToAnsi(
      grid,
      terminalWidth - offset,
      CHARACTERS[character].palette,
    ),
    offset,
  };
}

function widgetFrame(character, size, state, frameIndex, terminalWidth, runMotion) {
  const { animation, lines, offset } = createFrame(
    character,
    size,
    state,
    frameIndex,
    terminalWidth,
    runMotion,
  );
  const padding = " ".repeat(offset);
  const renderedWidth = Math.min(
    SPRITE_SIZES[size].width,
    terminalWidth - offset,
  );
  const trailingPadding = " ".repeat(
    terminalWidth - offset - renderedWidth,
  );
  const innerWidth = terminalWidth + 3;
  const title = ` catch-the-fox · ${character} · ${size} `;
  const fitLine = (line) => line.slice(0, innerWidth).padEnd(innerWidth);
  let output = `${ESC}H${ESC}J`;
  output += `  ╭─${title}${"─".repeat(Math.max(0, innerWidth - title.length - 1))}╮\n`;
  output += `  │${fitLine(`  ${state.padEnd(7)} — ${stateNotes[state]}`)}│\n`;
  output += `  ├${"─".repeat(innerWidth)}┤\n`;
  output += `  │${fitLine(`   ${animation.label}`)}│\n`;
  output += `  │${" ".repeat(innerWidth)}│\n`;
  for (const line of lines) {
    output += `  │   ${padding}${line}${trailingPadding}│\n`;
  }
  output += `  ╰${"─".repeat(innerWidth)}╯\n`;
  return output;
}

function visibleWidth(line) {
  return line.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function padAnsi(line, width) {
  return `${line}${" ".repeat(Math.max(0, width - visibleWidth(line)))}`;
}

function comparisonPreview(state, frameIndex) {
  const sections = [];
  for (const character of CHARACTER_IDS) {
    sections.push(`\x1b[1m${CHARACTERS[character].name.toUpperCase()}\x1b[22m`);
    const rendered = SPRITE_SIZE_IDS.map((size) => {
      const width = SPRITE_SIZES[size].width;
      const runMotion = new FoxRunMotion(width);
      const { animation, lines } = createFrame(
        character,
        size,
        state,
        frameIndex,
        width,
        runMotion,
      );
      return { animation, lines, size, width };
    });
    const columnGap = "     ";
    sections.push(
      rendered
        .map(({ size, width }) => `${size} (${width}×${SPRITE_SIZES[size].height})`.padEnd(width))
        .join(columnGap),
    );
    sections.push(
      rendered
        .map(({ animation, width }) => animation.label.slice(0, width).padEnd(width))
        .join(columnGap),
    );
    const height = Math.max(...rendered.map(({ lines }) => lines.length));
    for (let lineIndex = 0; lineIndex < height; lineIndex += 1) {
      sections.push(
        rendered
          .map(({ lines, width }) => padAnsi(lines[lineIndex] ?? "", width))
          .join(columnGap),
      );
    }
    sections.push("");
  }
  return `${ESC}H${ESC}J${sections.join("\n")}\n`;
}

async function animateState(character, size, state, continuous) {
  const animation = CHARACTERS[character].animations[state];
  const runMotion = new FoxRunMotion(SPRITE_SIZES[size].width);
  const frameCount = continuous
    ? Number.POSITIVE_INFINITY
    : Math.max(animation.grids.length * 3, 8);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const terminalWidth = Math.max(
      SPRITE_SIZES[size].width,
      (process.stdout.columns ?? 80) - 7,
    );
    process.stdout.write(
      widgetFrame(
        character,
        size,
        state,
        frameIndex,
        terminalWidth,
        runMotion,
      ),
    );
    if (state === "run") runMotion.advance(terminalWidth);
    await delay(
      animation.frameDurationsMs?.[
        frameIndex % animation.grids.length
      ] ?? animation.intervalMs,
    );
  }
}

async function animateComparison(state, continuous) {
  const frameCount = continuous ? Number.POSITIVE_INFINITY : 12;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    process.stdout.write(comparisonPreview(state, frameIndex));
    await delay(220);
  }
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function frameRectangles(frame, palette, offsetX, offsetY, pixelSize) {
  const rectangles = [];
  for (let row = 0; row < frame.length; row += 1) {
    for (let column = 0; column < frame[row].length; column += 1) {
      const colorKey = frame[row][column];
      if (colorKey === ".") continue;
      const [red, green, blue] = palette[colorKey];
      rectangles.push(
        `<rect x="${offsetX + column * pixelSize}" y="${offsetY + row * pixelSize}" width="${pixelSize}" height="${pixelSize}" fill="rgb(${red} ${green} ${blue})"/>`,
      );
    }
  }
  return rectangles.join("");
}

async function renderSheet(outputArgument) {
  const { default: sharp } = await import("sharp");
  const outputPath = path.resolve(outputArgument || "fox-preview.png");
  const pixelSize = 4;
  const cellPadding = 12;
  const titleHeight = 34;
  const largest = SPRITE_SIZES.large;
  const cellWidth = largest.width * pixelSize + cellPadding * 2;
  const cellHeight = largest.height * pixelSize + titleHeight + cellPadding * 2;
  const columns = FOX_STATES.length;
  const rows = CHARACTER_IDS.length * SPRITE_SIZE_IDS.length;
  const cells = [];

  for (const [characterIndex, character] of CHARACTER_IDS.entries()) {
    for (const [sizeIndex, size] of SPRITE_SIZE_IDS.entries()) {
      const row = characterIndex * SPRITE_SIZE_IDS.length + sizeIndex;
      for (const [stateIndex, state] of FOX_STATES.entries()) {
        const cellX = stateIndex * cellWidth;
        const cellY = row * cellHeight;
        const dimensions = SPRITE_SIZES[size];
        const frame = scaleGrid(
          CHARACTERS[character].animations[state].grids[0],
          size,
        );
        const frameX = cellX + Math.floor((cellWidth - dimensions.width * pixelSize) / 2);
        const frameY = cellY + titleHeight + cellPadding;
        const title = `${character} · ${size}`;
        cells.push(
          `<rect x="${cellX + 1}" y="${cellY + 1}" width="${cellWidth - 2}" height="${cellHeight - 2}" rx="8" fill="#fffaf3" stroke="#d9cfc2"/><text x="${cellX + cellPadding}" y="${cellY + 17}" font-family="ui-monospace, monospace" font-size="11" font-weight="700" fill="#2b1f1a">${escapeXml(title)}</text><text x="${cellX + cellPadding}" y="${cellY + 31}" font-family="ui-monospace, monospace" font-size="10" fill="#6b5b52">${escapeXml(state)}</text>${frameRectangles(frame, CHARACTERS[character].palette, frameX, frameY, pixelSize)}`,
        );
      }
    }
  }

  const width = cellWidth * columns;
  const height = cellHeight * rows;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#eee6dc"/>${cells.join("")}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  process.stdout.write(`${outputPath}\n`);
}

async function renderAllFrames(outputArgument) {
  const { default: sharp } = await import("sharp");
  const outputPath = path.resolve(outputArgument || "fox-frames.png");
  const pixelSize = 4;
  const gap = 8;
  const titleHeight = 22;
  const largest = SPRITE_SIZES.large;
  const cellWidth = largest.width * pixelSize;
  const cellHeight = largest.height * pixelSize;
  const animations = CHARACTER_IDS.flatMap((character) =>
    FOX_STATES.map((state) => ({
      character,
      state,
      animation: CHARACTERS[character].animations[state],
    })),
  );
  const maximumFrames = Math.max(
    ...animations.map(({ animation }) => animation.grids.length),
  );
  const rows = animations.length * SPRITE_SIZE_IDS.length;
  const width = gap + maximumFrames * (cellWidth + gap);
  const height = gap + rows * (cellHeight + titleHeight + gap);
  const cells = [];
  let row = 0;

  for (const { character, state, animation } of animations) {
    for (const size of SPRITE_SIZE_IDS) {
      const dimensions = SPRITE_SIZES[size];
      const rowY = gap + row * (cellHeight + titleHeight + gap);
      row += 1;
      cells.push(
        `<text x="${gap}" y="${rowY + 15}" font-family="ui-monospace, monospace" font-size="12" font-weight="700" fill="#2b1f1a">${escapeXml(`${character} · ${state} · ${size}`)}</text>`,
      );
      animation.grids.forEach((sourceFrame, frameIndex) => {
        const frame = scaleGrid(sourceFrame, size);
        const cellX = gap + frameIndex * (cellWidth + gap);
        const frameX = cellX + Math.floor(
          (cellWidth - dimensions.width * pixelSize) / 2,
        );
        const frameY = rowY + titleHeight +
          (largest.height - dimensions.height) * pixelSize;
        cells.push(
          `<rect x="${cellX}" y="${rowY + titleHeight}" width="${cellWidth}" height="${cellHeight}" fill="#fffaf3"/>${frameRectangles(frame, CHARACTERS[character].palette, frameX, frameY, pixelSize)}`,
        );
      });
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#eee6dc"/>${cells.join("")}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  process.stdout.write(`${outputPath}\n`);
}

async function terminalPreview() {
  const requestedState = argumentValue("--state");
  const state = requestedState
    ? assertChoice(requestedState, FOX_STATES, "Estado")
    : undefined;
  const comparison = process.argv.includes("--compare");
  const character = assertChoice(
    argumentValue("--character") ?? "fox",
    CHARACTER_IDS,
    "Personagem",
  );
  const size = assertChoice(
    argumentValue("--size") ?? "large",
    SPRITE_SIZE_IDS,
    "Tamanho",
  );
  process.stdout.write(`${ESC}?25l`);
  const restoreCursor = () => process.stdout.write(`${ESC}?25h`);
  process.once("exit", restoreCursor);
  process.once("SIGINT", () => process.exit(130));
  if (comparison) {
    await animateComparison(state ?? "run", Boolean(state));
  } else if (state) {
    await animateState(character, size, state, true);
  } else {
    for (const nextState of FOX_STATES) {
      await animateState(character, size, nextState, false);
    }
  }
  restoreCursor();
  process.removeListener("exit", restoreCursor);
  process.stdout.write("\nPreview concluído.\n");
}

const sheetOutput = argumentValue("--sheet");
const framesOutput = argumentValue("--frames");

if (process.argv.includes("--frames")) {
  await renderAllFrames(framesOutput);
} else if (process.argv.includes("--sheet")) {
  await renderSheet(sheetOutput);
} else {
  await terminalPreview();
}
