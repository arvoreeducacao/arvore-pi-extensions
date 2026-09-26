import assert from "node:assert/strict";
import test from "node:test";
import monitorExtension from "../dist/index.js";

// monitor.ts keeps its registry in module scope, so every test uses a unique monitor id.
function createHarness() {
  const tools = new Map();
  const handlers = new Map();
  const messages = [];

  monitorExtension({
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand: () => {},
    on: (event, handler) => handlers.set(event, handler),
    sendUserMessage: (content, options) => messages.push({ content, options }),
  });

  const ctx = { mode: "tui", ui: { setStatus() {}, notify() {} } };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const eventCount = async (id) => {
    const result = await tools
      .get("monitor_list")
      .execute("call", {}, undefined, undefined, ctx);
    return result.details.monitors.find((m) => m.id === id)?.eventCount ?? 0;
  };

  return {
    messages,
    sleep,
    eventCount,
    lines: () => messages.map((m) => m.content),
    start: (params) =>
      tools.get("monitor_start").execute("call", params, undefined, undefined, ctx),
    stop: (params) =>
      tools.get("monitor_stop").execute("call", params, undefined, undefined, ctx),
    shutdown: () => handlers.get("session_shutdown")({}, ctx),
  };
}

async function waitFor(predicate, { timeout = 5000, interval = 20 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error("timed out waiting for condition");
}

test("coalesces a burst of lines into a single notification", async () => {
  const harness = createHarness();
  await harness.start({
    id: "burst",
    command: 'for i in 1 2 3; do echo "line $i"; done; sleep 30',
    coalesceMs: 800,
  });

  await waitFor(() => harness.messages.length >= 1);
  await harness.sleep(400);

  assert.deepEqual(harness.lines(), [
    "[monitor:burst] (out ×3)\n  line 1\n  line 2\n  line 3",
  ]);
  assert.equal(harness.messages[0].options.deliverAs, "steer");

  await harness.stop({ id: "burst" });
});

test("a lone line keeps the original one-line format", async () => {
  const harness = createHarness();
  await harness.start({
    id: "single",
    command: 'echo "only line"; sleep 30',
    coalesceMs: 200,
  });

  await waitFor(() => harness.messages.length >= 1);
  assert.equal(harness.messages[0].content, "[monitor:single] (out) only line");

  await harness.stop({ id: "single" });
});

test("coalesceMs 0 pushes every line immediately", async () => {
  const harness = createHarness();
  await harness.start({
    id: "immediate",
    command: "echo a; echo b; echo c; sleep 30",
    coalesceMs: 0,
  });

  await waitFor(() => harness.messages.length >= 3);
  assert.deepEqual(harness.lines(), [
    "[monitor:immediate] (out) a",
    "[monitor:immediate] (out) b",
    "[monitor:immediate] (out) c",
  ]);

  await harness.stop({ id: "immediate" });
});

test("deliverAs is forwarded to every notification", async () => {
  const harness = createHarness();
  await harness.start({
    id: "followup",
    command: "echo quiet; sleep 30",
    deliverAs: "followUp",
    coalesceMs: 200,
  });

  await waitFor(() => harness.messages.length >= 1);
  assert.equal(harness.messages[0].options.deliverAs, "followUp");

  await harness.stop({ id: "followup" });
});

test("exit flushes buffered lines before reporting the exit code", async () => {
  const harness = createHarness();
  await harness.start({
    id: "exitflush",
    command: "echo first; echo second; exit 7",
    coalesceMs: 5000,
  });

  await waitFor(() => harness.messages.length >= 2);
  assert.deepEqual(harness.lines(), [
    "[monitor:exitflush] (out ×2)\n  first\n  second",
    "[monitor:exitflush] (exit) Process finished (exit code 7).",
  ]);
});

test("a batch mixing stdout and stderr tags each line", async () => {
  const harness = createHarness();
  await harness.start({
    id: "mixed",
    command: "echo to-out; echo to-err >&2; sleep 30",
    coalesceMs: 800,
  });

  await waitFor(() => harness.messages.length >= 1);
  await harness.sleep(400);

  assert.equal(harness.messages.length, 1);
  const [header, ...body] = harness.messages[0].content.split("\n");
  assert.equal(header, "[monitor:mixed] (2 lines)");
  assert.deepEqual(
    new Set(body.map((line) => line.trim())),
    new Set(["(out) to-out", "(err) to-err"]),
  );

  await harness.stop({ id: "mixed" });
});

test("flood flushes buffered lines before reporting the flood", async () => {
  const harness = createHarness();
  await harness.start({
    id: "flood",
    command: 'for i in 1 2 3 4 5; do echo "spam $i"; done; sleep 30',
    maxEventsPerWindow: 3,
    coalesceMs: 5000,
  });

  await waitFor(() => harness.messages.length >= 2);
  assert.deepEqual(harness.lines(), [
    "[monitor:flood] (out ×3)\n  spam 1\n  spam 2\n  spam 3",
    harness.messages[1].content,
  ]);
  assert.match(harness.messages[1].content, /exceeded 3 events in 60s and was auto-stopped/);
});

test("monitor_stop flushes buffered lines instead of dropping them", async () => {
  const harness = createHarness();
  await harness.start({
    id: "stopflush",
    command: "echo before-stop; sleep 30",
    coalesceMs: 5000,
  });

  await waitFor(async () => (await harness.eventCount("stopflush")) > 0);
  assert.deepEqual(harness.lines(), []);
  await harness.stop({ id: "stopflush" });

  assert.deepEqual(harness.lines(), ["[monitor:stopflush] (out) before-stop"]);
});

test("session_shutdown drops buffered lines instead of pushing them", async () => {
  const harness = createHarness();
  await harness.start({
    id: "ondown",
    command: "echo orphan; sleep 30",
    coalesceMs: 400,
  });

  await waitFor(async () => (await harness.eventCount("ondown")) > 0);
  await harness.shutdown();
  await harness.sleep(800);

  assert.deepEqual(harness.messages, []);
});
