import { FOX_WIDTH } from "./fox-art.js";

export type FoxRunDirection = "left" | "right";
export type FoxRunPhase = "running" | "skidding";

export interface FoxRunPlacement {
  direction: FoxRunDirection;
  offset: number;
  phase: FoxRunPhase;
}

const RUN_STEP = 3;
const SKID_DISTANCE = 12;
const SKID_PROGRESS = [0.25, 0.48, 0.68, 0.84, 0.95, 1] as const;

interface Skid {
  frame: number;
  start: number;
  target: number;
}

type DustPixel = readonly [x: number, y: number, color: "H" | "Q"];

export function orientFoxGrid(
  grid: string[],
  direction: FoxRunDirection,
): string[] {
  if (direction === "left") return grid;
  return grid.map((row) => [...row].reverse().join(""));
}

export function renderRunGrid(
  grid: string[],
  placement: Pick<FoxRunPlacement, "direction" | "phase">,
): string[] {
  const orientedGrid = orientFoxGrid(grid, placement.direction);
  if (placement.phase === "running" || orientedGrid.length < 3) {
    return orientedGrid;
  }

  const pixels = orientedGrid.map((row) => [...row]);
  const width = pixels[0]?.length ?? 0;
  const rightDust: DustPixel[] = [
    [0, pixels.length - 3, "Q"],
    [1, pixels.length - 2, "H"],
    [2, pixels.length - 1, "Q"],
  ];
  const leftDust: DustPixel[] = [
    [width - 1, pixels.length - 3, "Q"],
    [width - 2, pixels.length - 2, "H"],
    [width - 3, pixels.length - 1, "Q"],
  ];
  const dust = placement.direction === "right" ? rightDust : leftDust;

  for (const [x, y, color] of dust) {
    if (x >= 0 && pixels[y]?.[x] === ".") pixels[y][x] = color;
  }

  return pixels.map((row) => row.join(""));
}

export class FoxRunMotion {
  private direction: FoxRunDirection = "right";
  private maximumOffset = 0;
  private offset = 0;
  private phase: FoxRunPhase = "running";
  private skid: Skid | null = null;

  snapshot(terminalWidth: number): FoxRunPlacement {
    this.fitToWidth(terminalWidth);
    return this.placement();
  }

  advance(terminalWidth: number): FoxRunPlacement {
    this.fitToWidth(terminalWidth);
    if (this.maximumOffset === 0) return this.placement();
    if (this.skid) return this.advanceSkid();
    this.phase = "running";

    const target = this.direction === "right" ? this.maximumOffset : 0;
    const remainingDistance = Math.abs(target - this.offset);
    if (remainingDistance <= SKID_DISTANCE) {
      this.phase = "skidding";
      this.skid = { frame: 0, start: this.offset, target };
      return this.advanceSkid();
    }

    this.offset += this.direction === "right" ? RUN_STEP : -RUN_STEP;
    return this.placement();
  }

  private advanceSkid(): FoxRunPlacement {
    const skid = this.skid;
    if (!skid) return this.placement();

    const progress = SKID_PROGRESS[skid.frame];
    this.offset = Math.round(
      skid.start + (skid.target - skid.start) * progress,
    );
    skid.frame += 1;

    if (skid.frame === SKID_PROGRESS.length) {
      this.offset = skid.target;
      this.direction = this.direction === "right" ? "left" : "right";
      this.skid = null;
    }

    return this.placement();
  }

  private fitToWidth(terminalWidth: number): void {
    const nextMaximumOffset = Math.max(
      0,
      Math.floor(terminalWidth) - FOX_WIDTH,
    );
    if (nextMaximumOffset === this.maximumOffset) return;

    this.maximumOffset = nextMaximumOffset;
    this.offset = Math.min(this.offset, this.maximumOffset);
    this.phase = "running";
    this.skid = null;

    if (this.offset === this.maximumOffset && this.direction === "right") {
      this.direction = "left";
    } else if (this.offset === 0 && this.direction === "left") {
      this.direction = "right";
    }
  }

  private placement(): FoxRunPlacement {
    return {
      direction: this.direction,
      offset: this.offset,
      phase: this.phase,
    };
  }
}
