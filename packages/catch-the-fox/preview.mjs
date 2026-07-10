import path from "node:path";
import process from "node:process";
import {
  ANIMS,
  FOX_HEIGHT,
  FOX_STATES,
  FOX_WIDTH,
  PALETTE,
} from "./dist/fox-art.js";
import { gridToAnsi } from "./dist/index.js";
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
  sleep: "ocioso, esperando você",
};

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function argumentValue(name) {
  const argumentIndex = process.argv.indexOf(name);
  return argumentIndex === -1 ? undefined : process.argv[argumentIndex + 1];
}

function assertState(state) {
  if (!state || !FOX_STATES.includes(state)) {
    throw new Error(`Estado inválido. Use: ${FOX_STATES.join(", ")}`);
  }
  return state;
}

function widgetFrame(state, frameIndex, terminalWidth, runMotion) {
  const animation = ANIMS[state];
  let frame = animation.grids[frameIndex % animation.grids.length];
  let offset = 0;
  if (state === "run") {
    const placement = runMotion.snapshot(terminalWidth);
    frame = renderRunGrid(frame, placement);
    offset = placement.offset;
  }
  const lines = gridToAnsi(frame, terminalWidth - offset);
  const padding = " ".repeat(offset);
  const renderedWidth = Math.min(FOX_WIDTH, terminalWidth - offset);
  const trailingPadding = " ".repeat(
    terminalWidth - offset - renderedWidth,
  );
  const innerWidth = terminalWidth + 3;
  const title = " catch-the-fox ";
  const fitLine = (line) => line.slice(0, innerWidth).padEnd(innerWidth);
  let output = `${ESC}H${ESC}J`;
  output += `  ╭─${title}${"─".repeat(innerWidth - title.length - 1)}╮\n`;
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

async function animateState(state, continuous) {
  const animation = ANIMS[state];
  const runMotion = new FoxRunMotion();
  const frameCount = continuous
    ? Number.POSITIVE_INFINITY
    : Math.max(animation.grids.length * 3, 8);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const terminalWidth = Math.max(
      FOX_WIDTH,
      (process.stdout.columns ?? 80) - 7,
    );
    process.stdout.write(
      widgetFrame(state, frameIndex, terminalWidth, runMotion),
    );
    if (state === "run") runMotion.advance(terminalWidth);
    await delay(animation.intervalMs);
  }
}

async function terminalPreview() {
  const requestedState = argumentValue("--state");
  process.stdout.write(`${ESC}?25l`);
  const restoreCursor = () => process.stdout.write(`${ESC}?25h`);
  process.once("exit", restoreCursor);
  process.once("SIGINT", () => process.exit(130));
  if (requestedState) {
    await animateState(assertState(requestedState), true);
    return;
  }
  for (const state of FOX_STATES) await animateState(state, false);
  restoreCursor();
  process.removeListener("exit", restoreCursor);
  process.stdout.write("\nA raposa passou por todos os estados.\n");
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function frameRectangles(frame, offsetX, offsetY, pixelSize) {
  const rectangles = [];
  for (let row = 0; row < FOX_HEIGHT; row += 1) {
    for (let column = 0; column < FOX_WIDTH; column += 1) {
      const colorKey = frame[row][column];
      if (colorKey === ".") continue;
      const [red, green, blue] = PALETTE[colorKey];
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
  const frameGap = 8;
  const cellPadding = 16;
  const titleHeight = 30;
  const columns = 2;
  const rows = Math.ceil(FOX_STATES.length / columns);
  const maximumFrames = Math.max(
    ...FOX_STATES.map((state) => ANIMS[state].grids.length),
  );
  const frameWidth = FOX_WIDTH * pixelSize;
  const frameHeight = FOX_HEIGHT * pixelSize;
  const cellWidth =
    cellPadding * 2 + maximumFrames * frameWidth + (maximumFrames - 1) * frameGap;
  const cellHeight = cellPadding * 2 + titleHeight + frameHeight;
  const width = cellWidth * columns;
  const height = cellHeight * rows;
  const cells = FOX_STATES.map((state, stateIndex) => {
    const column = stateIndex % columns;
    const row = Math.floor(stateIndex / columns);
    const cellX = column * cellWidth;
    const cellY = row * cellHeight;
    const title = `${state} · ${ANIMS[state].label}`;
    const frames = ANIMS[state].grids
      .map((frame, frameIndex) =>
        frameRectangles(
          frame,
          cellX + cellPadding + frameIndex * (frameWidth + frameGap),
          cellY + cellPadding + titleHeight,
          pixelSize,
        ),
      )
      .join("");
    return `<rect x="${cellX + 1}" y="${cellY + 1}" width="${cellWidth - 2}" height="${cellHeight - 2}" rx="8" fill="#fffaf3" stroke="#d9cfc2"/><text x="${cellX + cellPadding}" y="${cellY + cellPadding + 17}" font-family="ui-monospace, monospace" font-size="15" font-weight="700" fill="#2b1f1a">${escapeXml(title)}</text>${frames}`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#eee6dc"/>${cells}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  process.stdout.write(`${outputPath}\n`);
}

const sheetOutput = argumentValue("--sheet");

if (process.argv.includes("--sheet")) {
  await renderSheet(sheetOutput);
} else {
  await terminalPreview();
}
