import { type FoxState, type RGB, PALETTE } from "./fox-art.js";
import {
  CHARACTERS,
  type CharacterId,
} from "./characters.js";
import {
  FoxRunMotion,
  orientFoxGrid,
  renderRunGrid,
} from "./fox-run-motion.js";
import {
  scaleGridToDimensions,
  type SpriteSize,
} from "./sprite-size.js";
import { SwimJourney } from "./swim-journey.js";

const PATROL_STEP = 1;

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const fg = ([r, g, b]: RGB) => `${ESC}38;2;${r};${g};${b}m`;
const bg = ([r, g, b]: RGB) => `${ESC}48;2;${r};${g};${b}m`;

export function gridToAnsi(
  grid: string[],
  maximumWidth = Number.POSITIVE_INFINITY,
  palette: Record<string, RGB> = PALETTE,
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
      const topColor = top[column] === "." ? null : palette[top[column]];
      const bottomColor =
        bottom[column] === "." ? null : palette[bottom[column]];
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

function animationGrids(
  character: CharacterId,
  size: SpriteSize,
  state: FoxState,
): string[][] {
  const dimensions = CHARACTERS[character].spriteDimensions[size];
  return trimLeadingBlankRows(
    CHARACTERS[character].animations[state].grids.map((grid) =>
      scaleGridToDimensions(grid, dimensions),
    ),
  );
}

export class FoxWidget {
  private animationTimer: ReturnType<typeof setTimeout> | null = null;
  private frameIndex = 0;
  private hidden = false;
  private patrolMotion: FoxRunMotion | null = null;
  private runMotion: FoxRunMotion;
  private state: FoxState = "sleep";
  private swimJourney: SwimJourney | null = null;
  private terminalWidth: number;
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;
  private ui: any = null;
  private widgetRegistered = false;
  private widgetTui: any = null;

  constructor(
    private readonly reducedMotion: boolean,
    private character: CharacterId = "fox",
    private size: SpriteSize = "large",
  ) {
    const spriteWidth =
      CHARACTERS[character].spriteDimensions[size].width;
    this.runMotion = new FoxRunMotion(spriteWidth);
    this.terminalWidth = spriteWidth;
  }

  setUI(nextUI: any): void {
    if (this.ui === nextUI) return;
    this.clearWidget();
    this.ui = nextUI;
    this.render();
  }

  setState(nextState: FoxState): void {
    const enteringRun = nextState === "run" && this.state !== "run";
    this.clearTimers();
    this.state = nextState;
    this.frameIndex = 0;
    if (enteringRun) this.resetRunMotion();
    this.resetStateMotion();
    this.render();
    if (this.hidden) return;

    const animation = CHARACTERS[this.character].animations[this.state];
    if (!this.reducedMotion) this.scheduleNextFrame(animation);

    if (animation.once) {
      this.transitionTimer = setTimeout(
        () => this.setState(animation.once?.then ?? "sleep"),
        animation.once.durationMs,
      );
      this.transitionTimer.unref?.();
    }
  }

  setCharacter(character: CharacterId): void {
    if (character === this.character) return;
    this.character = character;
    this.resetRunMotion();
    this.setState(this.state);
  }

  setSize(size: SpriteSize): void {
    if (size === this.size) return;
    this.size = size;
    this.resetRunMotion();
    this.setState(this.state);
  }

  getCharacter(): CharacterId {
    return this.character;
  }

  getSize(): SpriteSize {
    return this.size;
  }

  completeTurn(): void {
    this.setState("jump");
    const animation = CHARACTERS[this.character].animations.jump;
    const duration = this.character === "fox"
      ? 1400
      : animation.frameDurationsMs?.reduce(
          (total, frameDuration) => total + frameDuration,
          0,
        ) ?? animation.intervalMs * animation.grids.length;
    this.transitionTimer = setTimeout(() => this.setState("caught"), duration);
    this.transitionTimer.unref?.();
  }

  hide(): void {
    this.hidden = true;
    this.clearTimers();
    this.render();
  }

  show(): void {
    this.showState(this.state);
  }

  showState(nextState: FoxState): void {
    this.hidden = false;
    this.setState(nextState);
  }

  shutdown(): void {
    this.clearTimers();
    this.clearWidget();
    this.ui = null;
  }

  private scheduleNextFrame(animation: (typeof CHARACTERS)[CharacterId]["animations"][FoxState]): void {
    if (animation.holdLastFrame && this.frameIndex >= animation.grids.length - 1) {
      return;
    }
    const duration = this.swimJourney
      ? this.swimJourney.frameDurationMs()
      : animation.frameDurationsMs?.[this.frameIndex] ?? animation.intervalMs;
    this.animationTimer = setTimeout(() => {
      this.frameIndex = animation.holdLastFrame
        ? Math.min(this.frameIndex + 1, animation.grids.length - 1)
        : (this.frameIndex + 1) % animation.grids.length;
      if (this.state === "run") {
        this.runMotion.advance(this.terminalWidth);
      } else if (this.swimJourney) {
        this.swimJourney.advance(this.terminalWidth);
      } else if (this.patrolMotion) {
        this.patrolMotion.advance(this.terminalWidth);
      }
      this.render();
      this.scheduleNextFrame(animation);
    }, duration);
    this.animationTimer.unref?.();
  }

  private resetRunMotion(): void {
    this.runMotion = new FoxRunMotion(
      CHARACTERS[this.character].spriteDimensions[this.size].width,
    );
  }

  private resetStateMotion(): void {
    this.patrolMotion = null;
    this.swimJourney = null;
    const animation = CHARACTERS[this.character].animations[this.state];
    const dimensions = CHARACTERS[this.character].spriteDimensions[this.size];
    if (animation.motion === "patrol") {
      this.patrolMotion = new FoxRunMotion(dimensions.width, PATROL_STEP, 0);
      return;
    }
    if (animation.motion === "swim-journey" && animation.journey) {
      const scale = (grids: string[][]) =>
        grids.map((grid) => scaleGridToDimensions(grid, dimensions));
      this.swimJourney = new SwimJourney(
        {
          walkGrids: scale(animation.journey.walkGrids),
          walkDurationsMs: animation.journey.walkDurationsMs,
          diveGrids: scale(animation.journey.diveGrids),
          diveDurationsMs: animation.journey.diveDurationsMs,
          swimGrids: scale(animation.journey.swimGrids),
          swimDurationsMs: animation.journey.swimDurationsMs,
        },
        CHARACTERS[this.character].sourceFacing,
      );
    }
  }

  private clearTimers(): void {
    if (this.animationTimer) {
      clearTimeout(this.animationTimer);
      this.animationTimer = null;
    }
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
  }

  private renderLines = (width: number): string[] => {
    this.terminalWidth = Math.max(0, Math.floor(width));
    const animation = CHARACTERS[this.character].animations[this.state];
    const label = ` ${animation.label}`.slice(0, this.terminalWidth);
    if (this.swimJourney) {
      const frame = gridToAnsi(
        this.swimJourney.composeGrid(this.terminalWidth),
        this.terminalWidth,
        CHARACTERS[this.character].palette,
      );
      return [label, ...frame];
    }
    const grids = animationGrids(this.character, this.size, this.state);
    let grid = grids[this.frameIndex % grids.length];
    let offset = 0;
    if (this.state === "run") {
      const placement = this.runMotion.snapshot(this.terminalWidth);
      grid = renderRunGrid(
        grid,
        placement,
        CHARACTERS[this.character].sourceFacing,
      );
      offset = placement.offset;
    } else if (this.patrolMotion) {
      const placement = this.patrolMotion.snapshot(this.terminalWidth);
      grid = orientFoxGrid(
        grid,
        placement.direction,
        CHARACTERS[this.character].sourceFacing,
      );
      offset = placement.offset;
    }
    const frame = gridToAnsi(
      grid,
      this.terminalWidth - offset,
      CHARACTERS[this.character].palette,
    );
    const padding = " ".repeat(offset);
    return [label, ...frame.map((line) => `${padding}${line}`)];
  };

  private clearWidget(): void {
    if (!this.ui || !this.widgetRegistered) return;
    try {
      this.ui.setWidget("catch-the-fox", undefined);
    } catch {}
    this.widgetRegistered = false;
    this.widgetTui = null;
  }

  private render(): void {
    if (!this.ui) return;
    if (this.hidden) {
      this.clearWidget();
      return;
    }
    if (!this.widgetRegistered) {
      try {
        this.ui.setWidget("catch-the-fox", (tui: any) => {
          this.widgetTui = tui;
          return {
            render: this.renderLines,
            invalidate: () => {
              this.widgetRegistered = false;
              this.widgetTui = null;
            },
          };
        });
        this.widgetRegistered = true;
      } catch {}
      return;
    }
    try {
      if (this.widgetTui?.requestRender) this.widgetTui.requestRender();
      else this.ui.requestRender?.();
    } catch {}
  }
}
