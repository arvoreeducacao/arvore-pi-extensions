import assert from "node:assert/strict";
import test from "node:test";
import {
  FoxRunMotion,
  orientFoxGrid,
} from "../dist/fox-run-motion.js";

test("the fox skids at the terminal edge and runs back", () => {
  const terminalWidth = 80;
  const rightEdge = 56;
  const motion = new FoxRunMotion();
  const placements = [motion.snapshot(terminalWidth)];

  for (let frame = 0; frame < 80; frame += 1) {
    placements.push(motion.advance(terminalWidth));
  }

  assert.deepEqual(placements[0], {
    direction: "right",
    offset: 0,
    phase: "running",
  });
  assert.ok(
    placements.every(
      ({ offset }) => offset >= 0 && offset <= rightEdge,
    ),
  );

  const skidStart = placements.findIndex(
    ({ direction, phase }) =>
      direction === "right" && phase === "skidding",
  );
  const rightTurn = placements.findIndex(
    ({ direction, offset }) => direction === "left" && offset === rightEdge,
  );
  const runningBack = placements.findIndex(
    ({ direction, offset }, index) =>
      index > rightTurn && direction === "left" && offset < rightEdge,
  );

  assert.ok(skidStart > 0);
  assert.ok(rightTurn > skidStart);
  assert.ok(runningBack > rightTurn);
  assert.equal(placements[runningBack].phase, "running");

  const skidOffsets = placements
    .slice(skidStart - 1, rightTurn + 1)
    .map(({ offset }) => offset);
  const skidSteps = skidOffsets
    .slice(1)
    .map((offset, index) => offset - skidOffsets[index]);

  assert.ok(skidSteps.every((step) => step >= 0));
  assert.ok(skidSteps.at(-1) <= skidSteps[0]);
});

test("the fox stays visible in narrow and resized terminals", () => {
  const motion = new FoxRunMotion();

  for (let frame = 0; frame < 20; frame += 1) {
    assert.equal(motion.advance(20).offset, 0);
  }

  assert.equal(motion.advance(80).offset, 3);
  for (let frame = 0; frame < 8; frame += 1) {
    motion.advance(80);
  }

  const resizedPlacement = motion.snapshot(30);

  assert.equal(resizedPlacement.offset, 6);
  assert.equal(resizedPlacement.direction, "left");
  assert.equal(resizedPlacement.phase, "running");
});

test("the fox faces the direction it is running", () => {
  const leftFacingGrid = ["FOX.", "TAIL"];

  assert.deepEqual(orientFoxGrid(leftFacingGrid, "left"), leftFacingGrid);
  assert.deepEqual(orientFoxGrid(leftFacingGrid, "right"), [
    ".XOF",
    "LIAT",
  ]);
  assert.deepEqual(leftFacingGrid, ["FOX.", "TAIL"]);
});
