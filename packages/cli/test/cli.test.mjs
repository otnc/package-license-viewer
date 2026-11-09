import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/plv.js", import.meta.url));
const fixture = fileURLToPath(new URL("../../../test/fixtures/workspace/", import.meta.url));
const manifest = join(fixture, "package.json");
const unsavedManifest = '{\n  "dependencies": {\n    "plv-local-pkg": "^1.0.0"\n  }\n}';

const run = (args, input = "") =>
  spawnSync(process.execPath, [cli, "--cache-ttl-hours", "0", ...args], {
    input,
    encoding: "utf8",
    timeout: 10000,
  });

test("reports resolved metadata from a stdin manifest using neighboring packages", () => {
  const result = run(["--stdin", "--format", "json", manifest], unsavedManifest);
  assert.equal(result.status, 0, result.stderr);
  const entries = JSON.parse(result.stdout);
  assert.equal(entries.length, 1);
  const [{ path, line, name, license, version, source, severity }] = entries;
  assert.deepEqual(
    { path, line, name, license, version, source, severity },
    {
      path: manifest,
      line: 3,
      name: "plv-local-pkg",
      license: "MIT",
      version: "1.2.0",
      source: "local",
      severity: "info",
    }
  );
});

test("denies a license even when it also appears on the allowlist", () => {
  const result = run(["--stdin", "--allow", "MIT", "--deny", "MIT", manifest], unsavedManifest);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(
    result.stdout.trim(),
    `${manifest}:3:1: warning: plv-local-pkg: license MIT is denied`
  );
});

test("returns no findings when the policy allows every license", () => {
  const result = run(["--stdin", "--allow", "MIT", manifest], unsavedManifest);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("only ignores unsupported paths when asked", () => {
  const path = join(fixture, "tsconfig.json");
  assert.equal(run([path]).status, 2);
  const result = run(["--ignore-unsupported", "--format", "json", path]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), []);
});

test("reuses cached registry metadata across CLI processes", () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "plv-cli-test-"));
  const file = join(cacheRoot, "package.json");
  const input = '{"dependencies":{"plv-cache-fixture":"1.0.0"}}';
  const resolveLicense = (fetchCode, ttl) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "data:text/javascript," + encodeURIComponent(fetchCode),
        cli,
        "--stdin",
        "--format",
        "json",
        "--cache-ttl-hours",
        ttl,
        file,
      ],
      {
        env: { ...process.env, XDG_CACHE_HOME: cacheRoot },
        input,
        encoding: "utf8",
        timeout: 10000,
      }
    );
  try {
    const cached = resolveLicense(
      'globalThis.fetch = async () => Response.json({license:"MIT"})',
      "168"
    );
    assert.equal(cached.status, 0, cached.stderr);
    assert.equal(JSON.parse(cached.stdout)[0].license, "MIT");

    const unexpectedFetch =
      'globalThis.fetch = async () => { throw new Error("Unexpected registry request") }';
    const secondRun = resolveLicense(unexpectedFetch, "168");
    assert.equal(secondRun.status, 0, secondRun.stderr);
    assert.equal(JSON.parse(secondRun.stdout)[0].license, "MIT");

    const disabled = resolveLicense(unexpectedFetch, "0");
    assert.equal(disabled.status, 0, disabled.stderr);
    assert.equal(JSON.parse(disabled.stdout)[0].source, "unknown");
  } finally {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
});
