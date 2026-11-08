import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  compareVersions,
  normalizeVersion,
  parseConstraint,
  parseStability,
  satisfies,
} from "../src/providers/composer/spec";
import {
  isComposerJsonPath,
  isPackageName,
  isPlatformPackage,
  parseComposerJson,
} from "../src/providers/composer/parse";
import { fakeDocument } from "./support/fakeHost";

const fixtures = join(__dirname, "..", "..", "..", "test", "fixtures", "lockfiles");
const rows = (file: string) =>
  readFileSync(join(fixtures, file), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"));

// --- spec.ts ----------------------------------------------------------------

test("Composer constraints match the composer/semver oracle", () => {
  for (const [constraint, version, expected] of rows("composer-constraints.tsv")) {
    const parsed = parseConstraint(constraint);
    if (expected === "invalid-constraint") {
      expect(parsed.kind, constraint).toBe("invalid");
      continue;
    }
    if (expected === "invalid-version") {
      expect(normalizeVersion(version), version).toBeUndefined();
      continue;
    }
    expect(parsed.kind, constraint).toBe("valid");
    expect(satisfies(parsed, version), `${version} satisfies ${constraint}`).toBe(
      expected === "true"
    );
  }
});

test("Composer versions normalize like VersionParser::normalize", () => {
  for (const [input, expected] of rows("composer-normalize.tsv")) {
    expect(normalizeVersion(input) ?? "invalid", input).toBe(expected);
  }
});

test("Composer versions compare like version_compare on normalized strings", () => {
  for (const [a, b, expected] of rows("composer-compare.tsv")) {
    expect(
      Math.sign(compareVersions(normalizeVersion(a)!, normalizeVersion(b)!)),
      `${a} vs ${b}`
    ).toBe(Number(expected));
  }
});

test("constraint metadata: flags, implied stability, alias, dev branch", () => {
  expect(parseConstraint("^1.0@beta")).toMatchObject({ kind: "valid", stabilityFlag: "beta" });
  expect(parseConstraint("1.0.0-beta1")).toMatchObject({ kind: "valid", impliedStability: "beta" });
  expect(parseConstraint("^2.0-RC1 || ^3.0")).toMatchObject({
    kind: "valid",
    impliedStability: "RC",
  });
  // RootPackageLoader::extractStabilityFlags looks at every AND-split token, so this implies RC too
  expect(parseConstraint(">=2.0-RC1 <3.0")).toMatchObject({ impliedStability: "RC" });
  expect(parseConstraint(">=1.0 <2.0")).not.toHaveProperty("impliedStability");
  expect(parseConstraint("dev-main as 1.0.0")).toMatchObject({
    kind: "valid",
    alias: "1.0.0.0",
    devBranch: "dev-main",
  });
  expect(parseConstraint("1.x-dev")).toMatchObject({
    kind: "valid",
    devBranch: "1.9999999.9999999.9999999-dev",
  });
  expect(parseConstraint("dev-main#abc123")).toMatchObject({
    kind: "valid",
    devBranch: "dev-main",
  });
  expect(parseConstraint("^1.0")).not.toHaveProperty("devBranch");
  expect(parseConstraint("^1.0")).not.toHaveProperty("stabilityFlag");
  expect(parseStability("^2.0-RC1")).toBe("RC");
  expect(parseStability("1.2.3")).toBe("stable");
  expect(parseStability("dev-main")).toBe("dev");
  expect(parseStability("1.0.0-b2")).toBe("beta");
});

// --- parse.ts ---------------------------------------------------------------

test("composer.json require sections are read with lines, names lowercased, platform packages dropped", () => {
  const doc = fakeDocument(
    [
      "{",
      '  "name": "acme/app",',
      '  "require": {',
      '    "php": ">=8.1",',
      '    "ext-json": "*",',
      '    "Psr/Log": "^3.0",',
      '    "composer-runtime-api": "^2.2"',
      "  },",
      '  "require-dev": {',
      '    "psr/container": "^2.0@dev"',
      "  },",
      '  "config": { "vendor-dir": "lib/vendor" },',
      '  "minimum-stability": "RC",',
      '  "prefer-stable": true,',
      '  "repositories": [ { "packagist.org": false } ]',
      "}",
    ].join("\n"),
    "/repo/composer.json"
  );
  const manifest = parseComposerJson(doc, "/repo");
  expect(manifest.entries.map((e) => [e.name, e.spec, e.section, e.line, e.manifestDir])).toEqual([
    ["psr/log", "^3.0", "require", 5, "/repo"],
    ["psr/container", "^2.0@dev", "require-dev", 9, "/repo"],
  ]);
  expect(manifest.entries[1].constraint).toMatchObject({ kind: "valid", stabilityFlag: "dev" });
  expect(manifest).toMatchObject({
    vendorDir: "lib/vendor",
    minimumStability: "RC",
    preferStable: true,
    packagistEnabled: false,
  });
});

test("manifest defaults and the object form of repositories", () => {
  expect(
    parseComposerJson(fakeDocument('{"require":{"a/b":"1.0"}}', "/r/composer.json"), "/r")
  ).toMatchObject({
    vendorDir: "vendor",
    minimumStability: "stable",
    preferStable: false,
    packagistEnabled: true,
  });
  expect(
    parseComposerJson(
      fakeDocument('{"repositories":{"packagist":false}}', "/r/composer.json"),
      "/r"
    ).packagistEnabled
  ).toBe(false);
  expect(
    parseComposerJson(fakeDocument('{"minimum-stability":"nonsense"}', "/r/composer.json"), "/r")
      .minimumStability
  ).toBe("stable");
  // An invalid name is still an entry; resolve() rejects it later
  expect(
    parseComposerJson(
      fakeDocument('{"require":{"not-a-name":"1.0"}}', "/r/composer.json"),
      "/r"
    ).entries.map((e) => e.name)
  ).toEqual(["not-a-name"]);
});

test("a half-typed require never blanks out its neighbours", () => {
  const doc = fakeDocument('{"require": {"psr/log": "^3.0", "psr/cont', "/r/composer.json");
  expect(parseComposerJson(doc, "/r").entries.map((e) => e.name)).toEqual(["psr/log"]);
});

test("platform and invalid names, and which paths are project manifests", () => {
  for (const n of [
    "php",
    "PHP-64bit",
    "php-ipv6",
    "ext-json",
    "ext-pdo_mysql",
    "lib-curl",
    "hhvm",
    "composer",
    "composer-plugin-api",
    "composer-runtime-api",
  ]) {
    expect(isPlatformPackage(n), n).toBe(true);
  }
  expect(isPlatformPackage("php-fig/log")).toBe(false);
  expect(isPlatformPackage("extra/thing")).toBe(false);
  expect(isPackageName("psr/log")).toBe(true);
  expect(isPackageName("Psr/Log")).toBe(true);
  expect(isPackageName("symfony/polyfill-php80")).toBe(true);
  expect(isPackageName("psr")).toBe(false);
  expect(isPackageName("a//b")).toBe(false);
  expect(isPackageName("a/b c")).toBe(false);
  expect(isComposerJsonPath("/r/composer.json")).toBe(true);
  expect(isComposerJsonPath("composer.json")).toBe(true);
  expect(isComposerJsonPath("/r/vendor/psr/log/composer.json")).toBe(false);
  expect(isComposerJsonPath("/r/composer.lock")).toBe(false);
  expect(isComposerJsonPath("/r/package.json")).toBe(false);
});
