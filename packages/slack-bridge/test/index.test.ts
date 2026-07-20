import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import slackBridgeExtension, { type BridgeLoader } from "../src/index.js";

type Handler = (...args: any[]) => unknown;

const configKeys = [
  "SLACK_BRIDGE_BOT_TOKEN",
  "SLACK_BRIDGE_APP_TOKEN",
  "SLACK_BRIDGE_CHANNEL",
  "SLACK_BRIDGE_USER_IDS",
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
] as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHarness() {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, { handler: Handler }>();
  const eventHandlers = new Map<string, Handler>();
  const notifications: Array<[string, string]> = [];
  const statuses: Array<[string, string | undefined]> = [];
  const context = {
    isIdle: () => true,
    sessionManager: { getEntries: () => [] },
    ui: {
      notify: (message: string, level: string) => notifications.push([message, level]),
      setStatus: (key: string, value: string | undefined) => statuses.push([key, value]),
    },
  };
  const pi = {
    appendEntry: vi.fn(),
    sendUserMessage: vi.fn(),
    on: vi.fn((event: string, handler: Handler) => handlers.set(event, handler)),
    registerCommand: vi.fn((name: string, command: { handler: Handler }) => commands.set(name, command)),
    events: {
      emit: vi.fn(),
      on: vi.fn((event: string, handler: Handler) => eventHandlers.set(event, handler)),
    },
  };

  return { commands, context, eventHandlers, handlers, notifications, pi, statuses };
}

function createBridgeModule(startImplementation: () => Promise<void> = async () => {}) {
  const instances: FakeBridge[] = [];

  class FakeBridge {
    bindContext = vi.fn();
    restoreFromEntries = vi.fn();
    start = vi.fn(startImplementation);
    stop = vi.fn(async () => {});
    mirrorUserInput = vi.fn(async () => {});
    beginTurn = vi.fn(async () => {});
    recordTool = vi.fn(async () => {});
    recordToolResult = vi.fn(async () => {});
    recordAssistantMessage = vi.fn(async () => {});
    finishTurn = vi.fn(async () => {});
    handlePromptEvent = vi.fn(async () => {});

    constructor() {
      instances.push(this);
    }
  }

  return { module: { SlackBridge: FakeBridge }, instances };
}

describe("slack bridge extension", () => {
  const originalEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of configKeys) originalEnv.set(key, process.env[key]);
    process.env.SLACK_BRIDGE_BOT_TOKEN = "bot-token";
    process.env.SLACK_BRIDGE_APP_TOKEN = "app-token";
    process.env.SLACK_BRIDGE_CHANNEL = "channel";
  });

  afterEach(() => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    originalEnv.clear();
    vi.restoreAllMocks();
  });

  it("registers commands and handlers without loading the bridge", async () => {
    const harness = createHarness();
    const loader = vi.fn<BridgeLoader>();

    slackBridgeExtension(harness.pi as never, loader);

    expect(harness.commands.has("slack-bridge")).toBe(true);
    expect(harness.handlers.has("session_shutdown")).toBe(true);
    expect(harness.eventHandlers.has("arvore:ask-user:prompt")).toBe(true);
    expect(loader).not.toHaveBeenCalled();

    await harness.commands.get("slack-bridge")!.handler("status", harness.context);
    expect(loader).not.toHaveBeenCalled();
  });

  it("does not load the bridge when configuration is missing", async () => {
    delete process.env.SLACK_BRIDGE_BOT_TOKEN;
    delete process.env.SLACK_BRIDGE_APP_TOKEN;
    delete process.env.SLACK_BRIDGE_CHANNEL;
    const harness = createHarness();
    const loader = vi.fn<BridgeLoader>();

    slackBridgeExtension(harness.pi as never, loader);
    await harness.commands.get("slack-bridge")!.handler("on", harness.context);

    expect(loader).not.toHaveBeenCalled();
    expect(harness.notifications.at(-1)?.[1]).toBe("warning");
  });

  it("shares one lazy load and one start across concurrent activation", async () => {
    const activation = deferred<void>();
    const fake = createBridgeModule(() => activation.promise);
    const loader = vi.fn<BridgeLoader>().mockResolvedValue(fake.module as never);
    const harness = createHarness();

    slackBridgeExtension(harness.pi as never, loader);
    const command = harness.commands.get("slack-bridge")!.handler;
    const first = command("on", harness.context) as Promise<void>;
    const second = command("on", harness.context) as Promise<void>;
    await vi.waitFor(() => expect(fake.instances).toHaveLength(1));
    const third = command("on", harness.context) as Promise<void>;

    expect(loader).toHaveBeenCalledTimes(1);
    expect(fake.instances[0].start).toHaveBeenCalledTimes(1);

    activation.resolve();
    await Promise.all([first, second, third]);
    await harness.handlers.get("input")!({ source: "user", text: "hello" }, harness.context);

    expect(fake.instances[0].mirrorUserInput).toHaveBeenCalledWith("hello");
    expect(harness.notifications).toContainEqual(["Slack bridge conectada para esta sessão.", "info"]);
  });

  it("retries after a lazy import failure", async () => {
    const fake = createBridgeModule();
    const loader = vi
      .fn<BridgeLoader>()
      .mockRejectedValueOnce(new Error("import failed"))
      .mockResolvedValueOnce(fake.module as never);
    const harness = createHarness();

    slackBridgeExtension(harness.pi as never, loader);
    const command = harness.commands.get("slack-bridge")!.handler;
    await command("on", harness.context);
    await command("on", harness.context);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(fake.instances).toHaveLength(1);
    expect(fake.instances[0].start).toHaveBeenCalledTimes(1);
  });

  it("waits for activation before shutting down", async () => {
    const activation = deferred<void>();
    const fake = createBridgeModule(() => activation.promise);
    const loader = vi.fn<BridgeLoader>().mockResolvedValue(fake.module as never);
    const harness = createHarness();

    slackBridgeExtension(harness.pi as never, loader);
    const start = harness.commands.get("slack-bridge")!.handler("on", harness.context) as Promise<void>;
    await vi.waitFor(() => expect(fake.instances).toHaveLength(1));
    const shutdown = harness.handlers.get("session_shutdown")!() as Promise<void>;

    expect(fake.instances[0].stop).not.toHaveBeenCalled();
    activation.resolve();
    await Promise.all([start, shutdown]);

    expect(fake.instances[0].stop).toHaveBeenCalledTimes(1);
    expect(harness.statuses.at(-1)).toEqual(["slack-bridge", undefined]);
  });
});
