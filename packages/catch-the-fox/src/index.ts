import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  ANIMS,
  FOX_WIDTH,
  PALETTE,
  type FoxState,
  type RGB,
} from "./fox-art.js";
import { FoxRunMotion, orientFoxGrid } from "./fox-run-motion.js";

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const fg = ([r, g, b]: RGB) => `${ESC}38;2;${r};${g};${b}m`;
const bg = ([r, g, b]: RGB) => `${ESC}48;2;${r};${g};${b}m`;

export function gridToAnsi(
  grid: string[],
  maximumWidth = Number.POSITIVE_INFINITY,
): string[] {
  const lines: string[] = [];
  for (let row = 0; row < grid.length; row += 2) {
    const top = grid[row];
    const bottom = grid[row + 1] ?? ".".repeat(top.length);
    const width = Math.min(
      top.length,
      Number.isFinite(maximumWidth)
        ? Math.max(0, Math.floor(maximumWidth))
        : top.length,
    );
    let line = "";
    for (let column = 0; column < width; column++) {
      const topColor = top[column] === "." ? null : PALETTE[top[column]];
      const bottomColor =
        bottom[column] === "." ? null : PALETTE[bottom[column]];
      if (!topColor && !bottomColor) {
        line += `${RESET} `;
      } else if (topColor && bottomColor) {
        line += `${fg(topColor)}${bg(bottomColor)}▀`;
      } else if (topColor) {
        line += `${RESET}${fg(topColor)}▀`;
      } else {
        line += `${RESET}${fg(bottomColor as RGB)}▄`;
      }
    }
    lines.push(`${line}${RESET}`);
  }
  return lines;
}

function isBlankRow(row: string): boolean {
  return /^\.*$/.test(row);
}

function trimLeadingBlankRows(grids: string[][]): string[][] {
  let blankRows = Infinity;
  for (const grid of grids) {
    let count = 0;
    while (count < grid.length && isBlankRow(grid[count])) count += 1;
    blankRows = Math.min(blankRows, count);
  }
  if (!Number.isFinite(blankRows) || blankRows <= 0) return grids;
  const evenBlankRows = blankRows - (blankRows % 2);
  if (evenBlankRows <= 0) return grids;
  return grids.map((grid) => grid.slice(evenBlankRows));
}

const TRIMMED_GRIDS = Object.fromEntries(
  Object.entries(ANIMS).map(([state, animation]) => [
    state,
    trimLeadingBlankRows(animation.grids),
  ]),
) as Record<FoxState, string[][]>;

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

export default function catchTheFoxExtension(pi: ExtensionAPI): void {
  let ui: any = null;
  let state: FoxState = "sleep";
  let hidden = false;
  let frameIndex = 0;
  let animationTimer: ReturnType<typeof setInterval> | null = null;
  let transitionTimer: ReturnType<typeof setTimeout> | null = null;
  let errorStreak = 0;
  let terminalWidth = FOX_WIDTH;
  let runMotion = new FoxRunMotion();

  const widgetId = "catch-the-fox";

  function clearTimers(): void {
    if (animationTimer) {
      clearInterval(animationTimer);
      animationTimer = null;
    }
    if (transitionTimer) {
      clearTimeout(transitionTimer);
      transitionTimer = null;
    }
  }

  function render(): void {
    if (!ui) return;
    if (hidden) {
      try {
        ui.setWidget(widgetId, undefined);
      } catch {}
      return;
    }
    const renderState = state;
    const renderFrameIndex = frameIndex;
    try {
      ui.setWidget(widgetId, () => ({
        render: (width: number) => {
          terminalWidth = Math.max(0, Math.floor(width));
          const grids = TRIMMED_GRIDS[renderState];
          let grid = grids[renderFrameIndex % grids.length];
          let offset = 0;
          if (renderState === "run") {
            const placement = runMotion.snapshot(terminalWidth);
            grid = orientFoxGrid(grid, placement.direction);
            offset = placement.offset;
          }
          const frame = gridToAnsi(grid, terminalWidth - offset);
          const padding = " ".repeat(offset);
          const label = ` ${ANIMS[renderState].label}`.slice(
            0,
            terminalWidth,
          );
          return [label, ...frame.map((line) => `${padding}${line}`)];
        },
        invalidate: () => {},
      }));
    } catch {}
  }

  function setState(nextState: FoxState): void {
    const enteringRun = nextState === "run" && state !== "run";
    clearTimers();
    state = nextState;
    frameIndex = 0;
    if (enteringRun) runMotion = new FoxRunMotion();
    render();
    if (hidden) return;
    animationTimer = setInterval(() => {
      frameIndex += 1;
      if (state === "run") runMotion.advance(terminalWidth);
      render();
    }, ANIMS[state].intervalMs);
    animationTimer.unref?.();
    const transition = ANIMS[state].once;
    if (transition) {
      transitionTimer = setTimeout(
        () => setState(transition.then),
        transition.durationMs,
      );
      transitionTimer.unref?.();
    }
  }

  pi.on("session_start", async (_event, context) => {
    ui = context.ui;
    setState("sleep");
  });

  pi.on("agent_start", async (_event, context) => {
    ui = context.ui;
    errorStreak = 0;
    setState("sniff");
  });

  pi.on("tool_execution_start", async (event: any, context: any) => {
    ui = context.ui;
    setState(stateForTool(event.toolName ?? ""));
  });

  pi.on("tool_result", async (event: any, context: any) => {
    ui = context.ui;
    if (event.isError) {
      errorStreak += 1;
      setState(errorStreak >= 3 ? "sad" : "error");
    } else {
      errorStreak = 0;
    }
  });

  pi.on("agent_end", async (_event, context) => {
    ui = context.ui;
    if (errorStreak >= 3) {
      setState("sad");
      return;
    }
    setState("jump");
    transitionTimer = setTimeout(() => setState("caught"), 1400);
    transitionTimer.unref?.();
  });

  pi.on("session_shutdown", async () => {
    clearTimers();
  });

  pi.registerCommand("fox", {
    description:
      "Controla a raposa: /fox <sleep|sniff|dig|run|jump|caught|error|sad|hide|show>",
    handler: async (args, context) => {
      if (!context.hasUI) {
        context.ui.notify("/fox requer modo interativo", "error");
        return;
      }
      ui = context.ui;
      const requestedState = (args ?? "").trim().toLowerCase();
      if (requestedState === "hide") {
        hidden = true;
        clearTimers();
        render();
        context.ui.notify(
          "raposa escondida (/fox show pra voltar)",
          "info",
        );
        return;
      }
      if (requestedState === "show") {
        hidden = false;
        setState(state);
        context.ui.notify("raposa on!", "info");
        return;
      }
      if (requestedState && requestedState in ANIMS) {
        hidden = false;
        setState(requestedState as FoxState);
        return;
      }
      context.ui.notify(
        `Estados: ${Object.keys(ANIMS).join(", ")} · hide · show`,
        "info",
      );
    },
  });
}
