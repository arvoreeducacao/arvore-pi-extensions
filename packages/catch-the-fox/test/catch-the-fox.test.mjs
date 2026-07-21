import assert from "node:assert/strict";
import test from "node:test";
import catchTheFoxExtension, {
  CHARACTERS,
  SPRITE_SIZES,
  scaleGridToDimensions,
} from "../dist/index.js";
import { CAPYBARA_SOURCE } from "../dist/capybara-art.js";

const ANSI_SEQUENCE = /\x1b\[[0-9;]*m/g;

function visibleWidth(line) {
  return line.replace(ANSI_SEQUENCE, "").length;
}

function createMemoryPreferenceStore(initial = { character: "fox", size: "large" }) {
  let preferences = { ...initial };
  return {
    async load() {
      return { ...preferences };
    },
    async save(nextPreferences) {
      preferences = { ...nextPreferences };
    },
    current() {
      return { ...preferences };
    },
  };
}

function extensionHarness(flags = {}, preferenceStore = createMemoryPreferenceStore()) {
  const timeoutCallbacks = [];
  const handlers = new Map();
  const commands = new Map();
  const notifications = [];
  let widgetFactory;
  let widgetRegistrations = 0;
  let renderRequests = 0;

  catchTheFoxExtension({
    on(event, handler) {
      handlers.set(event, handler);
    },
    registerCommand(name, command) {
      commands.set(name, command);
    },
    registerFlag() {},
    getFlag(name) {
      return flags[name];
    },
  }, preferenceStore);

  const context = {
    hasUI: true,
    ui: {
      notify(message, level) {
        notifications.push({ level, message });
      },
      setWidget(_id, content) {
        widgetFactory = content;
        if (content) widgetRegistrations += 1;
      },
    },
  };

  return {
    commands,
    context,
    handlers,
    notifications,
    preferenceStore,
    timeoutCallbacks,
    getWidget() {
      return widgetFactory({
        requestRender() {
          renderRequests += 1;
        },
      });
    },
    get widgetRegistrations() {
      return widgetRegistrations;
    },
    get renderRequests() {
      return renderRequests;
    },
  };
}

test("the run animation crosses the widget without wrapping", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timeoutCallbacks = [];

  globalThis.setTimeout = (callback) => {
    timeoutCallbacks.push(callback);
    return { unref() {} };
  };
  globalThis.clearTimeout = () => {};

  try {
    const harness = extensionHarness();
    await harness.handlers.get("session_start")({}, harness.context);
    await harness.handlers.get("tool_execution_start")(
      { toolName: "exec_command" },
      harness.context,
    );

    const widget = harness.getWidget();
    const narrowLines = widget.render(20);
    assert.ok(narrowLines.every((line) => visibleWidth(line) <= 20));

    const initialLines = widget.render(80);
    assert.equal(visibleWidth(initialLines[1]), 24);

    let edgeLines = initialLines;
    for (let frame = 0; frame < 80; frame += 1) {
      timeoutCallbacks.shift()?.();
      edgeLines = widget.render(80);
      if (visibleWidth(edgeLines[1]) === 80) break;
    }

    assert.ok(edgeLines.every((line) => visibleWidth(line) <= 80));
    assert.equal(visibleWidth(edgeLines[1]), 80);

    timeoutCallbacks.shift()?.();
    const returnLines = widget.render(80);
    assert.equal(visibleWidth(returnLines[1]), 77);
    assert.equal(harness.widgetRegistrations, 1);
    assert.ok(harness.renderRequests > 0);

    await harness.handlers.get("session_shutdown")({}, harness.context);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("reduced motion keeps the selected character and size static", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const timeoutCallbacks = [];
  globalThis.setTimeout = (callback) => {
    timeoutCallbacks.push(callback);
    return { unref() {} };
  };

  try {
    const harness = extensionHarness({
      "fox-character": "capybara",
      "fox-reduced-motion": true,
      "fox-size": "small",
    });
    await harness.handlers.get("session_start")({}, harness.context);
    await harness.handlers.get("tool_execution_start")(
      { toolName: "exec_command" },
      harness.context,
    );

    const lines = harness.getWidget().render(80);
    assert.match(lines[0], /capivarando atrás/);
    const smallDimensions = CHARACTERS.capybara.spriteDimensions.small;
    assert.equal(visibleWidth(lines[1]), smallDimensions.width);
    assert.equal(lines.length - 1, smallDimensions.height / 2);
    assert.equal(timeoutCallbacks.length, 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("the fox command switches character and size", async () => {
  const harness = extensionHarness({ "fox-reduced-motion": true });
  await harness.handlers.get("session_start")({}, harness.context);
  const command = harness.commands.get("fox");

  await command.handler("character", harness.context);
  await command.handler("size medium", harness.context);
  await command.handler("run", harness.context);

  const lines = harness.getWidget().render(80);
  assert.match(lines[0], /capivarando atrás/);
  assert.equal(
    visibleWidth(lines[1]),
    CHARACTERS.capybara.spriteDimensions.medium.width,
  );
  assert.equal(
    harness.notifications.at(-1)?.message,
    "Tamanho salvo: medium",
  );
  assert.deepEqual(harness.preferenceStore.current(), {
    character: "capybara",
    size: "medium",
  });
});

test("character and size preferences survive a new session", async () => {
  const preferenceStore = createMemoryPreferenceStore();
  const firstSession = extensionHarness(
    { "fox-reduced-motion": true },
    preferenceStore,
  );
  await firstSession.handlers.get("session_start")({}, firstSession.context);
  const command = firstSession.commands.get("fox");
  await command.handler("character capybara", firstSession.context);
  await command.handler("size small", firstSession.context);

  const nextSession = extensionHarness(
    { "fox-reduced-motion": true },
    preferenceStore,
  );
  await nextSession.handlers.get("session_start")({}, nextSession.context);
  await nextSession.handlers.get("tool_execution_start")(
    { toolName: "exec_command" },
    nextSession.context,
  );

  const lines = nextSession.getWidget().render(80);
  assert.match(lines[0], /capivarando atrás/);
  assert.equal(
    visibleWidth(lines[1]),
    CHARACTERS.capybara.spriteDimensions.small.width,
  );
});

test("CLI flags override saved preferences without replacing them", async () => {
  const preferenceStore = createMemoryPreferenceStore({
    character: "capybara",
    size: "small",
  });
  const harness = extensionHarness(
    {
      "fox-character": "fox",
      "fox-reduced-motion": true,
      "fox-size": "large",
    },
    preferenceStore,
  );
  await harness.handlers.get("session_start")({}, harness.context);
  await harness.handlers.get("tool_execution_start")(
    { toolName: "exec_command" },
    harness.context,
  );

  const lines = harness.getWidget().render(80);
  assert.match(lines[0], /correndo atrás/);
  assert.equal(visibleWidth(lines[1]), SPRITE_SIZES.large.width);
  assert.deepEqual(preferenceStore.current(), {
    character: "capybara",
    size: "small",
  });
});

test("the capybara preserves all animations and frames", () => {
  const sourceAnimations = Object.values(CAPYBARA_SOURCE);
  const frameCount = sourceAnimations.reduce(
    (total, animation) => total + animation.grids.length,
    0,
  );

  assert.equal(sourceAnimations.length, 11);
  assert.equal(frameCount, 81);
  assert.ok(
    sourceAnimations.every(
      (animation) => animation.grids.length === animation.durationsMs.length,
    ),
  );
  assert.equal(CHARACTERS.capybara.animations.swim.grids.length, 7);
  for (const size of ["large", "medium", "small"]) {
    const swimFrames = CHARACTERS.capybara.animations.swim.grids.map((grid) =>
      scaleGridToDimensions(
        grid,
        CHARACTERS.capybara.spriteDimensions[size],
      ).join("\n"),
    );
    assert.equal(new Set(swimFrames).size, 7, `swim ${size}`);
  }
  const jumpTopRows = CAPYBARA_SOURCE.jump.grids.map((grid) =>
    grid.findIndex((row) => /[^.]/.test(row)),
  );
  assert.ok(Math.max(...jumpTopRows) > Math.min(...jumpTopRows));
  assert.equal(CHARACTERS.capybara.sourceFacing, "right");
});
