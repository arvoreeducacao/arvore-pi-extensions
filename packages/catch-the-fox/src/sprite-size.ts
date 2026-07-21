export type SpriteSize = "large" | "medium" | "small";

export interface SpriteDimensions {
  width: number;
  height: number;
}

export const SPRITE_SIZES: Record<SpriteSize, SpriteDimensions> = {
  large: { width: 24, height: 20 },
  medium: { width: 18, height: 16 },
  small: { width: 12, height: 10 },
};

export const SPRITE_SIZE_IDS = Object.keys(SPRITE_SIZES) as SpriteSize[];

export function isSpriteSize(value: string): value is SpriteSize {
  return SPRITE_SIZE_IDS.includes(value as SpriteSize);
}

function pixelFrequencies(grid: string[]): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const pixel of grid.join("")) {
    if (pixel === ".") continue;
    frequencies.set(pixel, (frequencies.get(pixel) ?? 0) + 1);
  }
  return frequencies;
}

function dominantOpaquePixel(
  pixels: string[],
  frequencies: ReadonlyMap<string, number>,
): string {
  const counts = new Map<string, number>();
  for (const pixel of pixels) {
    if (pixel === ".") continue;
    counts.set(pixel, (counts.get(pixel) ?? 0) + 1);
  }
  return [...counts].sort(([leftPixel, leftCount], [rightPixel, rightCount]) => {
    const leftFrequency = frequencies.get(leftPixel) ?? 0;
    const rightFrequency = frequencies.get(rightPixel) ?? 0;
    if (leftFrequency !== rightFrequency) return leftFrequency - rightFrequency;
    if (leftCount !== rightCount) return rightCount - leftCount;
    return leftPixel.localeCompare(rightPixel);
  })[0]?.[0] ?? ".";
}

export function scaleGridToDimensions(
  grid: string[],
  dimensions: SpriteDimensions,
): string[] {
  const { width, height } = dimensions;
  const sourceHeight = grid.length;
  const sourceWidth = grid[0]?.length ?? 0;
  if (sourceHeight === 0 || sourceWidth === 0) {
    return Array.from({ length: height }, () => ".".repeat(width));
  }
  if (sourceWidth === width && sourceHeight === height) return [...grid];

  const frequencies = pixelFrequencies(grid);
  return Array.from({ length: height }, (_, targetY) => {
    const sourceTop = Math.floor((targetY * sourceHeight) / height);
    const sourceBottom = Math.max(
      sourceTop + 1,
      Math.ceil(((targetY + 1) * sourceHeight) / height),
    );
    return Array.from({ length: width }, (_, targetX) => {
      const sourceLeft = Math.floor((targetX * sourceWidth) / width);
      const sourceRight = Math.max(
        sourceLeft + 1,
        Math.ceil(((targetX + 1) * sourceWidth) / width),
      );
      const pixels: string[] = [];
      for (let sourceY = sourceTop; sourceY < sourceBottom; sourceY += 1) {
        for (let sourceX = sourceLeft; sourceX < sourceRight; sourceX += 1) {
          pixels.push(grid[sourceY]?.[sourceX] ?? ".");
        }
      }
      return dominantOpaquePixel(pixels, frequencies);
    }).join("");
  });
}

export function scaleGrid(grid: string[], size: SpriteSize): string[] {
  return scaleGridToDimensions(grid, SPRITE_SIZES[size]);
}
