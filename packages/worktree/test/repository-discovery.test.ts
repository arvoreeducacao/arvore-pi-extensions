import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, test } from "node:test";
import { discoverRepos, findWorkspaceRoot } from "../src/repository-discovery.ts";

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "pi-worktree-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createGitRepo(directory: string): void {
  mkdirSync(join(directory, ".git"), { recursive: true });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("discovers a standalone repository containing AGENTS.md", () => {
  const repository = createTemporaryDirectory();
  createGitRepo(repository);
  writeFileSync(join(repository, "AGENTS.md"), "# Project\n");

  assert.deepEqual(discoverRepos(repository), [repository]);
  assert.equal(findWorkspaceRoot(repository), repository);
});

test("discovers the enclosing standalone repository from a nested directory", () => {
  const repository = createTemporaryDirectory();
  const nestedDirectory = join(repository, "src", "editor");
  createGitRepo(repository);
  mkdirSync(nestedDirectory, { recursive: true });
  writeFileSync(join(repository, "AGENTS.md"), "# Project\n");

  assert.deepEqual(discoverRepos(nestedDirectory), [repository]);
  assert.equal(findWorkspaceRoot(nestedDirectory), repository);
});

test("discovers immediate child repositories in an AGENTS.md hub", () => {
  const hub = createTemporaryDirectory();
  const firstRepository = join(hub, "alpha");
  const secondRepository = join(hub, "beta");
  mkdirSync(firstRepository);
  mkdirSync(secondRepository);
  createGitRepo(firstRepository);
  createGitRepo(secondRepository);
  writeFileSync(join(hub, "AGENTS.md"), "# Hub\n");

  assert.deepEqual(discoverRepos(firstRepository), [firstRepository, secondRepository]);
  assert.equal(findWorkspaceRoot(firstRepository), hub);
});

test("does not treat a standalone repository with a nested repository as a hub", () => {
  const repository = createTemporaryDirectory();
  const nestedRepository = join(repository, "vendor");
  createGitRepo(repository);
  mkdirSync(nestedRepository);
  createGitRepo(nestedRepository);
  writeFileSync(join(repository, "AGENTS.md"), "# Project\n");

  assert.deepEqual(discoverRepos(repository), [repository]);
  assert.equal(findWorkspaceRoot(repository), repository);
});

test("uses hub.config.ts as an explicit hub marker", () => {
  const hub = createTemporaryDirectory();
  const repository = join(hub, "app");
  mkdirSync(repository);
  createGitRepo(repository);
  writeFileSync(join(hub, "hub.config.ts"), "export default {};\n");

  assert.deepEqual(discoverRepos(repository).map((path) => basename(path)), ["app"]);
  assert.equal(findWorkspaceRoot(repository), hub);
});
