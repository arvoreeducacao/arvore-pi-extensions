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
  let widgetRegistrations = 0;
  let renderRequests = 0;

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
      registerFlag() {},
      getFlag() {
        return false;
      },
    });

    const context = {
      ui: {
        setWidget(_id, content) {
          widgetFactory = content;
          if (content) widgetRegistrations += 1;
        },
      },
    };

    await handlers.get("session_start")({}, context);
    await handlers.get("tool_execution_start")(
      { toolName: "exec_command" },
      context,
    );

    const widget = widgetFactory({
      requestRender() {
        renderRequests += 1;
      },
    });
    const narrowLines = widget.render(20);
    assert.ok(narrowLines.every((line) => visibleWidth(line) <= 20));

    const initialLines = widget.render(80);
    assert.equal(visibleWidth(initialLines[1]), 24);

    const runTick = intervalCallbacks.at(-1);
    let edgeLines = initialLines;
    for (let frame = 0; frame < 80; frame += 1) {
      runTick();
      edgeLines = widget.render(80);
      if (visibleWidth(edgeLines[1]) === 80) break;
    }

    assert.ok(edgeLines.every((line) => visibleWidth(line) <= 80));
    assert.equal(visibleWidth(edgeLines[1]), 80);

    runTick();
    const returnLines = widget.render(80);
    assert.equal(visibleWidth(returnLines[1]), 77);
    assert.equal(widgetRegistrations, 1);
    assert.ok(renderRequests > 0);

    await handlers.get("session_shutdown")({}, context);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test("reduced motion keeps the fox static while preserving state", async () => {
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
      registerFlag() {},
      getFlag() {
        return true;
      },
    });

    const context = {
      ui: {
        setWidget(_id, content) {
          if (content) widgetFactory = content;
        },
      },
    };

    await handlers.get("session_start")({}, context);
    await handlers.get("tool_execution_start")(
      { toolName: "exec_command" },
      context,
    );

    const lines = widgetFactory().render(80);
    assert.match(lines[0], /correndo atrás/);
    assert.equal(visibleWidth(lines[1]), 24);
    assert.equal(intervalCallbacks.length, 0);

    await handlers.get("session_shutdown")({}, context);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
