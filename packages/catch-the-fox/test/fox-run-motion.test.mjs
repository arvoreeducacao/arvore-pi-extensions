import assert from "node:assert/strict";
import test from "node:test";
import {
  FoxRunMotion,
  orientFoxGrid,
  renderRunGrid,
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
  const leftTurn = placements.findIndex(
    ({ direction, offset }, index) =>
      index > runningBack && direction === "right" && offset === 0,
  );
  const runningForward = placements.findIndex(
    ({ direction, offset }, index) =>
      index > leftTurn && direction === "right" && offset > 0,
  );

  assert.ok(skidStart > 0);
  assert.ok(rightTurn > skidStart);
  assert.ok(runningBack > rightTurn);
  assert.ok(leftTurn > runningBack);
  assert.ok(runningForward > leftTurn);
  assert.equal(placements[runningBack].phase, "running");

  const skidOffsets = placements
    .slice(skidStart - 1, rightTurn + 1)
    .map(({ offset }) => offset);
  const skidSteps = skidOffsets
    .slice(1)
    .map((offset, index) => offset - skidOffsets[index]);
  const runningStep = placements[1].offset - placements[0].offset;

  assert.ok(skidSteps.every((step) => step >= 0));
  assert.ok(skidSteps.every((step) => step <= runningStep));
  assert.ok(
    skidSteps.every(
      (step, index) => index === 0 || step <= skidSteps[index - 1],
    ),
  );
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

test("the skid never accelerates at any terminal width", () => {
  for (let terminalWidth = 25; terminalWidth <= 200; terminalWidth += 1) {
    const motion = new FoxRunMotion();
    let previousPlacement = motion.snapshot(terminalWidth);
    let skidSteps = [];
    let completedSkids = 0;

    for (let frame = 0; frame < 500; frame += 1) {
      const placement = motion.advance(terminalWidth);
      const step = Math.abs(placement.offset - previousPlacement.offset);
      if (placement.phase === "skidding") {
        skidSteps.push(step);
      } else if (skidSteps.length > 0) {
        assert.ok(
          skidSteps.every(
            (skidStep, index) =>
              skidStep <= 3 &&
              (index === 0 || skidStep <= skidSteps[index - 1]),
          ),
          `terminal width ${terminalWidth}: ${skidSteps.join(", ")}`,
        );
        completedSkids += 1;
        skidSteps = [];
      }
      previousPlacement = placement;
    }

    assert.ok(completedSkids > 0, `terminal width ${terminalWidth}`);
  }
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

test("the skid throws extra dust behind the fox", () => {
  const emptyGrid = Array.from({ length: 6 }, () => "......");
  const rightSkid = renderRunGrid(emptyGrid, {
    direction: "right",
    phase: "skidding",
  });
  const leftSkid = renderRunGrid(emptyGrid, {
    direction: "left",
    phase: "skidding",
  });

  assert.ok(rightSkid.some((row) => /^[QH]{1,3}/.test(row)));
  assert.ok(leftSkid.some((row) => /[QH]{1,3}$/.test(row)));
  assert.deepEqual(
    renderRunGrid(emptyGrid, {
      direction: "right",
      phase: "running",
    }),
    emptyGrid,
  );
});
