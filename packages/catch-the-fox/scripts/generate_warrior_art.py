#!/usr/bin/env python3
"""Regenerates src/warrior-art.ts from assets/warrior-fox.png.

The sheet is a 16x4 grid of 64x64 cells. Each animation occupies a column
range of one row. Frames are cropped to a per-animation union bounding box,
scaled with dominant-block sampling (keeps pixel-art edges crisp), quantized
to a fixed median-cut palette and bottom-aligned on a uniform canvas so the
renderer can treat every animation as the same dimensions.
"""
from collections import Counter
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SHEET = HERE.parent / "assets" / "warrior-fox.png"
OUTPUT = HERE.parent / "src" / "warrior-art.ts"

CELL = 64
ALPHA_THRESHOLD = 110
PALETTE_SIZE = 24
CANVAS_W = 28
CANVAS_H = 24

ANIMATIONS = {
    "idle": {"row": 2, "cols": range(0, 14), "durations": [160] * 14},
    "walk": {"row": 3, "cols": range(0, 5), "durations": [150] * 5},
    "run": {"row": 1, "cols": range(3, 9), "durations": [90] * 6},
    "slash": {"row": 1, "cols": range(0, 3), "durations": [110] * 3},
    "dash": {"row": 0, "cols": range(0, 4), "durations": [100] * 4},
    "bigSlash": {
        "row": 0,
        "cols": range(6, 16),
        "durations": [90, 90, 90, 80, 80, 80, 90, 150, 130, 110],
    },
    "hurt": {"row": 1, "cols": range(13, 15), "durations": [200, 200]},
}

CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"


def cell(sheet, row, col):
    return sheet.crop((col * CELL, row * CELL, col * CELL + CELL, row * CELL + CELL))


def content_bbox(frame):
    alpha = frame.getchannel("A")
    mask = alpha.point(lambda a: 255 if a >= ALPHA_THRESHOLD else 0)
    return mask.getbbox()


def drop_stray_components(frame):
    alpha = frame.getchannel("A")
    width, height = frame.size
    pixels = alpha.load()
    visited = [[False] * width for _ in range(height)]
    components = []
    for y in range(height):
        for x in range(width):
            if visited[y][x] or pixels[x, y] < ALPHA_THRESHOLD:
                continue
            stack = [(x, y)]
            visited[y][x] = True
            component = []
            while stack:
                cx, cy = stack.pop()
                component.append((cx, cy))
                for nx in (cx - 1, cx, cx + 1):
                    for ny in (cy - 1, cy, cy + 1):
                        if (
                            0 <= nx < width
                            and 0 <= ny < height
                            and not visited[ny][nx]
                            and pixels[nx, ny] >= ALPHA_THRESHOLD
                        ):
                            visited[ny][nx] = True
                            stack.append((nx, ny))
            components.append(component)
    if len(components) <= 1:
        return frame
    largest = max(len(component) for component in components)
    keep_minimum = max(4, int(largest * 0.02))
    cleaned = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    source = frame.load()
    target = cleaned.load()
    for component in components:
        if len(component) < keep_minimum:
            continue
        for cx, cy in component:
            target[cx, cy] = source[cx, cy]
    return cleaned


def build_palette(sheet):
    pixels = [
        (r, g, b)
        for r, g, b, a in sheet.getdata()
        if a >= ALPHA_THRESHOLD
    ]
    sample = Image.new("RGB", (len(pixels), 1))
    sample.putdata(pixels)
    quantized = sample.quantize(colors=PALETTE_SIZE, method=Image.MEDIANCUT)
    raw = quantized.getpalette()[: PALETTE_SIZE * 3]
    colors = [tuple(raw[i : i + 3]) for i in range(0, len(raw), 3)]
    colors.sort(key=lambda c: (sum(c), c))
    return colors


def nearest_index(color, palette):
    best, best_dist = 0, None
    for i, candidate in enumerate(palette):
        dist = sum((a - b) ** 2 for a, b in zip(color, candidate))
        if best_dist is None or dist < best_dist:
            best, best_dist = i, dist
    return best


def quantize_frame(frame, palette, cache):
    indexed = []
    for r, g, b, a in frame.getdata():
        if a < ALPHA_THRESHOLD:
            indexed.append(None)
            continue
        key = (r, g, b)
        if key not in cache:
            cache[key] = nearest_index(key, palette)
        indexed.append(cache[key])
    return indexed


def scale_block(indexed, src_w, src_h, dst_w, dst_h):
    out = []
    for ty in range(dst_h):
        sy0 = (ty * src_h) // dst_h
        sy1 = max(sy0 + 1, ((ty + 1) * src_h) // dst_h)
        row = []
        for tx in range(dst_w):
            sx0 = (tx * src_w) // dst_w
            sx1 = max(sx0 + 1, ((tx + 1) * src_w) // dst_w)
            votes = Counter()
            for sy in range(sy0, min(sy1, src_h)):
                for sx in range(sx0, min(sx1, src_w)):
                    value = indexed[sy * src_w + sx]
                    if value is not None:
                        votes[value] += 1
            row.append(votes.most_common(1)[0][0] if votes else None)
        out.append(row)
    return out


def main():
    sheet = Image.open(SHEET).convert("RGBA")
    palette = build_palette(sheet)
    cache = {}

    idle = ANIMATIONS["idle"]
    idle_frame = cell(sheet, idle["row"], idle["cols"][0])
    idle_h = content_bbox(idle_frame)[3] - content_bbox(idle_frame)[1]
    base_scale = (CANVAS_H - 2) / idle_h

    animations = {}
    for name, spec in ANIMATIONS.items():
        frames = [
            drop_stray_components(cell(sheet, spec["row"], c))
            for c in spec["cols"]
        ]
        boxes = [content_bbox(f) for f in frames]
        union = (
            min(b[0] for b in boxes),
            min(b[1] for b in boxes),
            max(b[2] for b in boxes),
            max(b[3] for b in boxes),
        )
        uw, uh = union[2] - union[0], union[3] - union[1]
        scale = min(base_scale, CANVAS_W / uw, CANVAS_H / uh)
        dw, dh = max(1, round(uw * scale)), max(1, round(uh * scale))
        grids = []
        for frame in frames:
            cropped = frame.crop(union)
            indexed = quantize_frame(cropped, palette, cache)
            scaled = scale_block(indexed, uw, uh, dw, dh)
            offset_x = (CANVAS_W - dw) // 2
            offset_y = CANVAS_H - dh
            canvas = [["." for _ in range(CANVAS_W)] for _ in range(CANVAS_H)]
            for ty, row in enumerate(scaled):
                for tx, value in enumerate(row):
                    if value is not None:
                        canvas[offset_y + ty][offset_x + tx] = CHARS[value]
            grids.append(["".join(row) for row in canvas])
        animations[name] = {"durations": spec["durations"], "grids": grids}

    emit(OUTPUT, palette, animations)


def emit(path, palette, animations):
    lines = [
        'import type { RGB } from "./fox-art.js";',
        "",
        "export interface WarriorSourceAnimation {",
        "  durationsMs: number[];",
        "  grids: string[][];",
        "}",
        "",
        f"export const WARRIOR_WIDTH = {CANVAS_W};",
        f"export const WARRIOR_HEIGHT = {CANVAS_H};",
        "",
        "export const WARRIOR_PALETTE: Record<string, RGB> = {",
    ]
    for i, (r, g, b) in enumerate(palette):
        lines.append(f'  "{CHARS[i]}": [{r}, {g}, {b}],')
    lines.append("};")
    lines.append("")
    lines.append("export const WARRIOR_SOURCE = {")
    for name, data in animations.items():
        lines.append(f"  {name}: {{")
        lines.append(f"    durationsMs: {data['durations']},")
        lines.append("    grids: [")
        for grid in data["grids"]:
            lines.append("      [")
            for row in grid:
                lines.append(f'        "{row}",')
            lines.append("      ],")
        lines.append("    ],")
        lines.append("  },")
    lines.append("} satisfies Record<string, WarriorSourceAnimation>;")
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf8")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
