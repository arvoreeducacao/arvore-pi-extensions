import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSecrets, loadCustomPatterns } from "../dist/secrets.js";
import { createRedactor } from "../dist/redact.js";

function fakeJwt(seed: string): string {
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const sig = Buffer.from(`sig-${seed}`.repeat(4)).toString("base64url");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: seed })}.${sig}`;
}


function withEnvFile(lines: string[], fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "sf-test-"));
  try {
    writeFileSync(join(dir, ".env"), lines.join("\n"));
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("captures sensitive .env values and skips trivial ones", () => {
  withEnvFile(
    [
      "DATABASE_URL=postgres://u:supersecretpw@db:5432/app",
      "OPENAI_API_KEY=sk-abc123def456ghi789jkl012",
      "PORT=3000",
      "NODE_ENV=production",
    ],
    (dir) => {
      const names = discoverSecrets(dir).map((e) => e.name);
      assert.ok(names.includes("DATABASE_URL"));
      assert.ok(names.includes("OPENAI_API_KEY"));
      assert.ok(!names.includes("PORT"));
      assert.ok(!names.includes("NODE_ENV"));
    },
  );
});

test("never treats infra/session env vars as secrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "sf-test-"));
  const names = discoverSecrets(dir).map((e) => e.name);
  rmSync(dir, { recursive: true, force: true });
  assert.ok(!names.includes("HOME"));
  assert.ok(!names.includes("PATH"));
  assert.ok(!names.includes("SSH_AUTH_SOCK"));
});

test("assigns stable self-descriptive placeholders", () => {
  withEnvFile(["STRIPE_SECRET=rk_live_xYz0123456789abcdef"], (dir) => {
    const entry = discoverSecrets(dir).find((e) => e.name === "STRIPE_SECRET");
    assert.ok(entry);
    assert.ok(entry.placeholder.includes("SECRET STRIPE_SECRET"));
    assert.ok(entry.placeholder.includes('"$STRIPE_SECRET"'));
  });
});

test("redactor replaces real values with placeholders", () => {
  withEnvFile(["DATABASE_URL=postgres://u:supersecretpw@db:5432/app"], (dir) => {
    const r = createRedactor(discoverSecrets(dir));
    const out = r.redactString("connecting to postgres://u:supersecretpw@db:5432/app now");
    assert.ok(!out.text.includes("supersecretpw"));
    assert.ok(out.text.includes('"$DATABASE_URL"'));
    assert.equal(out.hits, 1);
  });
});

test("redactor catches token patterns not present in env", () => {
  const r = createRedactor([]);
  const out = r.redactString("leaked AKIAIOSFODNN7EXAMPLE here");
  assert.ok(!out.text.includes("AKIAIOSFODNN7EXAMPLE"));
  assert.ok(out.text.includes('"$SECRET_AWS_ACCESS_KEY"'));
});

test("redactor leaves non-secret text untouched", () => {
  const r = createRedactor([]);
  const out = r.redactString("server listening on port 3000");
  assert.equal(out.text, "server listening on port 3000");
  assert.equal(out.hits, 0);
});

test("captures pattern-matched secrets for shell export", () => {
  const r = createRedactor([]);
  const jwt = fakeJwt("user-123");
  const out = r.redactString(`Authorization: Bearer ${jwt}`);
  assert.ok(!out.text.includes(jwt));
  assert.ok(out.text.includes('"$SECRET_JWT"'));
  const captured = r.drainCaptured();
  assert.equal(captured.length, 1);
  assert.equal(captured[0].name, "SECRET_JWT");
  assert.ok(captured[0].placeholder.includes('"$SECRET_JWT"'));
  assert.equal(captured[0].value, jwt);
});

test("drainCaptured returns each captured secret only once", () => {
  const r = createRedactor([]);
  const jwt = fakeJwt("user-123");
  r.redactString(jwt);
  assert.equal(r.drainCaptured().length, 1);
  r.redactString(jwt);
  assert.equal(r.drainCaptured().length, 0);
});

test("distinct pattern matches get distinct placeholders", () => {
  const r = createRedactor([]);
  const a = fakeJwt("aaa");
  const b = fakeJwt("bbb");
  const out = r.redactString(`${a} and ${b}`);
  assert.ok(!out.text.includes(a));
  assert.ok(!out.text.includes(b));
  assert.ok(out.text.includes('"$SECRET_JWT"'));
  assert.ok(out.text.includes('"$SECRET_JWT_2"'));
  const captured = r.drainCaptured();
  assert.equal(captured.length, 2);
});

test("loads custom patterns from .pi/secret-firewall.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "sf-test-"));
  try {
    mkdirSync(join(dir, ".pi"));
    writeFileSync(
      join(dir, ".pi", "secret-firewall.json"),
      JSON.stringify({ patterns: [{ name: "ACME", regex: "acme-[0-9a-f]{12}" }] }),
    );
    const patterns = loadCustomPatterns(dir);
    assert.equal(patterns.length, 1);
    assert.equal(patterns[0].name, "ACME");
    assert.equal(patterns[0].regex, "acme-[0-9a-f]{12}");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("redactor catches and captures custom pattern matches", () => {
  const r = createRedactor([], [{ name: "ACME", regex: "acme-[0-9a-f]{12}" }]);
  const token = "acme-0123456789ab";
  const out = r.redactString(`token is ${token} ok`);
  assert.ok(!out.text.includes(token));
  assert.ok(out.text.includes('"$SECRET_ACME"'));
  const captured = r.drainCaptured();
  assert.equal(captured.length, 1);
  assert.equal(captured[0].name, "SECRET_ACME");
  assert.equal(captured[0].value, token);
});

test("custom patterns are forced to global and coexist with defaults", () => {
  const r = createRedactor([], [{ name: "ACME", regex: "acme-[0-9a-f]{12}", flags: "i" }]);
  const out = r.redactString("acme-aaaaaaaaaaaa and acme-bbbbbbbbbbbb");
  assert.ok(out.text.includes('"$SECRET_ACME"'));
  assert.ok(out.text.includes('"$SECRET_ACME_2"'));
  assert.equal(r.drainCaptured().length, 2);
});

test("invalid custom regex is skipped without throwing", () => {
  const r = createRedactor([], [{ name: "BAD", regex: "([" }]);
  const out = r.redactString("nothing to redact here");
  assert.equal(out.hits, 0);
  assert.equal(out.text, "nothing to redact here");
});
