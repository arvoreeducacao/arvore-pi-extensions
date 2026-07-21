import type { SwimJourneySources } from "./fox-art.js";
import {
  orientFoxGrid,
  type FoxRunDirection,
} from "./fox-run-motion.js";

export type SwimJourneyPhase = "walk" | "dive" | "swim" | "flood" | "water";

const WALK_STEP = 1;
const DIVE_STEP = 2;
const SWIM_STEP = 2;
const WATER_TICK_MS = 400;
const WATER_CHARS = new Set(["c", "d", "e", "f", "i", "j", "k", "l", "n"]);

function findSurfaceRow(grid: string[]): number {
  for (let row = 0; row < grid.length; row += 1) {
    for (const pixel of grid[row]) {
      if (WATER_CHARS.has(pixel)) return row;
    }
  }
  return Math.max(0, Math.floor(grid.length / 2));
}

export class SwimJourney {
  private floodEdge: number | null = null;
  private frame = 0;
  private offset = 0;
  private phase: SwimJourneyPhase = "walk";
  private shimmer = 0;
  private readonly height: number;
  private readonly spriteWidth: number;
  private readonly surfaceRow: number;

  constructor(
    private readonly sources: SwimJourneySources,
    private readonly sourceFacing: FoxRunDirection,
  ) {
    this.height = sources.swimGrids[0]?.length ?? 0;
    this.spriteWidth = sources.swimGrids[0]?.[0]?.length ?? 0;
    this.surfaceRow = findSurfaceRow(sources.swimGrids[0] ?? []);
  }

  getPhase(): SwimJourneyPhase {
    return this.phase;
  }

  frameDurationMs(): number {
    if (this.phase === "walk") {
      const durations = this.sources.walkDurationsMs;
      return durations[this.frame % durations.length] ?? 100;
    }
    if (this.phase === "dive") {
      const durations = this.sources.diveDurationsMs;
      return durations[Math.min(this.frame, durations.length - 1)] ?? 100;
    }
    if (this.phase === "water") return WATER_TICK_MS;
    const durations = this.sources.swimDurationsMs;
    return durations[this.frame % durations.length] ?? 200;
  }

  advance(terminalWidth: number): void {
    const { maximumOffset, shore, walkTarget } = this.geometry(terminalWidth);
    this.shimmer += 1;
    this.offset = Math.min(this.offset, maximumOffset);

    switch (this.phase) {
      case "walk":
        this.frame += 1;
        this.offset = Math.min(this.offset + WALK_STEP, walkTarget);
        if (this.offset >= walkTarget) this.enterPhase("dive");
        break;
      case "dive":
        this.frame += 1;
        this.offset = Math.min(this.offset + DIVE_STEP, maximumOffset);
        if (this.frame >= this.sources.diveGrids.length) this.enterPhase("swim");
        break;
      case "swim":
        this.frame += 1;
        this.offset = Math.min(this.offset + SWIM_STEP, maximumOffset);
        if (this.offset >= maximumOffset) {
          this.floodEdge = Math.min(shore, this.offset);
          this.enterPhase("flood");
        }
        break;
      case "flood":
        this.frame += 1;
        this.offset = Math.max(0, this.offset - SWIM_STEP);
        this.floodEdge = Math.min(this.floodEdge ?? shore, this.offset);
        if (this.offset <= 0) {
          this.floodEdge = 0;
          this.enterPhase("water");
        }
        break;
      case "water":
        this.frame += 1;
        break;
    }
  }

  composeGrid(terminalWidth: number): string[] {
    const width = Math.max(1, Math.floor(terminalWidth));
    const { maximumOffset, shore } = this.geometry(width);
    const offset = Math.min(this.offset, maximumOffset);
    const waterStart =
      this.phase === "water"
        ? 0
        : this.phase === "flood"
          ? Math.min(this.floodEdge ?? shore, offset)
          : shore;

    const rows = Array.from({ length: this.height }, () =>
      new Array<string>(width).fill("."),
    );
    for (let x = Math.max(0, waterStart); x < width; x += 1) {
      if (this.surfaceRow < this.height) {
        rows[this.surfaceRow][x] = (x + this.shimmer) % 5 === 0 ? "k" : "d";
      }
      for (let y = this.surfaceRow + 1; y < this.height; y += 1) {
        rows[y][x] =
          (x * 7 + y * 13 + this.shimmer * 3) % 31 === 0 ? "l" : "d";
      }
    }

    const sprite = this.spriteGrid();
    if (sprite) {
      const oriented = orientFoxGrid(
        sprite,
        this.phase === "flood" ? "left" : "right",
        this.sourceFacing,
      );
      for (let y = 0; y < oriented.length && y < this.height; y += 1) {
        for (let x = 0; x < oriented[y].length; x += 1) {
          const pixel = oriented[y][x];
          if (pixel === ".") continue;
          const column = offset + x;
          if (column >= 0 && column < width) rows[y][column] = pixel;
        }
      }
    }

    return rows.map((row) => row.join(""));
  }

  private enterPhase(phase: SwimJourneyPhase): void {
    this.phase = phase;
    this.frame = 0;
  }

  private spriteGrid(): string[] | null {
    if (this.phase === "water") return null;
    if (this.phase === "walk") {
      const grids = this.sources.walkGrids;
      return grids[this.frame % grids.length] ?? null;
    }
    if (this.phase === "dive") {
      const grids = this.sources.diveGrids;
      return grids[Math.min(this.frame, grids.length - 1)] ?? null;
    }
    const grids = this.sources.swimGrids;
    return grids[this.frame % grids.length] ?? null;
  }

  private geometry(terminalWidth: number): {
    maximumOffset: number;
    shore: number;
    walkTarget: number;
  } {
    const width = Math.max(1, Math.floor(terminalWidth));
    const maximumOffset = Math.max(0, width - this.spriteWidth);
    const shore = Math.min(
      maximumOffset + Math.floor(this.spriteWidth / 2),
      Math.max(4, Math.floor(width * 0.45)),
    );
    const walkTarget = Math.max(
      0,
      Math.min(shore - Math.floor(this.spriteWidth / 2), maximumOffset),
    );
    return { maximumOffset, shore, walkTarget };
  }
}
