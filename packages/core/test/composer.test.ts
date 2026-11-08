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
