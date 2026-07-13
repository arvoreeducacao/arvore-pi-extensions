import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalHome = process.env.HOME;
const originalCloudUrl = process.env.GIT_REVIEW_CLOUD_URL;
const isolatedHome = mkdtempSync(join(tmpdir(), "git-review-bridge-test-"));
process.env.HOME = isolatedHome;
delete process.env.GIT_REVIEW_CLOUD_URL;

const { DEFAULT_CLOUD_URL, loadConfig } = await import("../dist/config.js");
const { default: registerExtension } = await import("../dist/index.js");

after(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalCloudUrl === undefined) delete process.env.GIT_REVIEW_CLOUD_URL;
  else process.env.GIT_REVIEW_CLOUD_URL = originalCloudUrl;
  rmSync(isolatedHome, { recursive: true, force: true });
});

test("uses the deployed git-review cloud URL by default", async () => {
  assert.equal(DEFAULT_CLOUD_URL, "https://git-review.arvore.dev");
  assert.deepEqual(await loadConfig(), { cloudUrl: DEFAULT_CLOUD_URL });
});

test("turns a rejected login request into a useful notification", async () => {
  const commands = new Map();
  const notifications = [];
  const pi = {
    registerCommand(name, command) {
      commands.set(name, command);
    },
    on() {},
    exec: async () => ({ stdout: "", stderr: "", code: 0 }),
    sendUserMessage() {},
    getSessionName: () => undefined,
  };
  registerExtension(pi);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed", { cause: new Error("simulated connection refused") });
  };

  try {
    const command = commands.get("review-cloud-login");
    assert.ok(command);
    await command.handler("", {
      ui: {
        notify(message, type) {
          notifications.push({ message, type });
        },
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(notifications, [
    {
      message:
        "git-review-cloud: could not reach https://git-review.arvore.dev (simulated connection refused)",
      type: "error",
    },
  ]);
});
