import assert from "node:assert/strict";
import test from "node:test";
import catchTheFoxExtension from "../dist/index.js";

const ANSI_SEQUENCE = /\x1b\[[0-9;]*m/g;

function visibleWidth(line) {
  return line.replace(ANSI_SEQUENCE, "").length;
}

test("the run animation crosses the widget without wrapping", async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const intervalCallbacks = [];
  const handlers = new Map();
  let widgetFactory;

  globalThis.setInterval = (callback) => {
    intervalCallbacks.push(callback);
    return { unref() {} };
  };
  globalThis.clearInterval = () => {};

  try {
    catchTheFoxExtension({
      on(event, handler) {
        handlers.set(event, handler);
      },
      registerCommand() {},
    });

    const context = {
      ui: {
        setWidget(_id, content) {
          widgetFactory = content;
        },
      },
    };

    await handlers.get("session_start")({}, context);
    await handlers.get("tool_execution_start")(
      { toolName: "exec_command" },
      context,
    );

    const narrowLines = widgetFactory().render(20);
    assert.ok(narrowLines.every((line) => visibleWidth(line) <= 20));

    const initialLines = widgetFactory().render(80);
    assert.equal(visibleWidth(initialLines[1]), 24);

    const runTick = intervalCallbacks.at(-1);
    for (let frame = 0; frame < 20; frame += 1) runTick();

    const edgeLines = widgetFactory().render(80);
    assert.ok(edgeLines.every((line) => visibleWidth(line) <= 80));
    assert.equal(visibleWidth(edgeLines[1]), 80);

    runTick();
    const returnLines = widgetFactory().render(80);
    assert.equal(visibleWidth(returnLines[1]), 77);

    await handlers.get("session_shutdown")({}, context);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
