import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_FOX_PREFERENCES,
  loadFoxPreferences,
  saveFoxPreferences,
} from "../dist/preferences.js";

test("preferences persist to disk and load in another session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "catch-the-fox-"));
  const filePath = join(directory, "preferences.json");

  try {
    await saveFoxPreferences(
      { character: "capybara", size: "small" },
      filePath,
    );

    assert.deepEqual(await loadFoxPreferences(filePath), {
      character: "capybara",
      size: "small",
    });
    assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), {
      character: "capybara",
      size: "small",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("missing, corrupt, and invalid preferences use safe defaults", async () => {
  const directory = await mkdtemp(join(tmpdir(), "catch-the-fox-"));
  const filePath = join(directory, "preferences.json");

  try {
    assert.deepEqual(
      await loadFoxPreferences(filePath),
      DEFAULT_FOX_PREFERENCES,
    );

    await writeFile(filePath, "not json", "utf8");
    assert.deepEqual(
      await loadFoxPreferences(filePath),
      DEFAULT_FOX_PREFERENCES,
    );

    await writeFile(
      filePath,
      JSON.stringify({ character: "otter", size: "huge" }),
      "utf8",
    );
    assert.deepEqual(
      await loadFoxPreferences(filePath),
      DEFAULT_FOX_PREFERENCES,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
