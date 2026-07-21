import assert from "node:assert/strict";
import test from "node:test";
import { scaleGridToDimensions } from "../dist/sprite-size.js";

test("downscaling preserves sparse opaque pixels inside each sample block", () => {
  const grid = [
    "....",
    ".A..",
    "...B",
    "....",
  ];

  assert.deepEqual(
    scaleGridToDimensions(grid, { width: 2, height: 2 }),
    ["A.", ".B"],
  );
});
