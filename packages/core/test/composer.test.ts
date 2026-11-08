import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { LicenseCache } from "../src/cache";
import { getConfig, invalidateConfigCache } from "../src/config";
import { buildHover, formatAnnotationSegments } from "../src/format";
import {
  expandMinified,
  PackagistClient,
  selectVersion,
  StandDown,
} from "../src/providers/composer/client";
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
import {
  combineLicenses,
  decodePackageRecord,
  packagePageUrl,
  recordSatisfies,
} from "../src/providers/composer/metadata";
import type { ValidConstraint } from "../src/providers/composer/spec";
import { ComposerLicenseProvider } from "../src/providers/composer";
import { InstalledLookup } from "../src/providers/composer/installed";
import { parseLock } from "../src/providers/composer/lockfile";
import { fakeDocument, fakeHost, fakeUri } from "./support/fakeHost";
import { setSettings } from "./support/vscodeStub";

const noCancel = {
  isCancellationRequested: false,
  onCancellationRequested: (_listener: (e: unknown) => unknown) => ({ dispose() {} }),
};
const makeCache = () => new LicenseCache({ get() {}, keys: () => [], async update() {} });

afterEach(() => {
  setSettings({});
  invalidateConfigCache();
});

/** Replace `fetch` with a recorder answering `https://repo.packagist.org/p2/<name>.json` from `answers` (a minified version list, or an HTTP status) */
function mountPackagist(answers: Record<string, unknown[] | number>) {
  const calls: string[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: string) => {
    calls.push(url);
    const match = /\/p2\/(.+)\.json$/.exec(url);
    const answer = match ? answers[match[1]] : undefined;
    if (answer === undefined) return { ok: false, status: 404, json: async () => ({}) };
    if (typeof answer === "number") return { ok: false, status: answer, json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ packages: { [match![1]]: answer }, minified: "composer/2.0" }),
    };
  }) as unknown as typeof fetch;
  return { calls, restore: () => (global.fetch = originalFetch) };
}

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

// --- metadata.ts ------------------------------------------------------------

test("package records decode from lock/installed/p2 shapes", () => {
  const rec = decodePackageRecord({
    name: "psr/log",
    version: "3.0.2",
    license: ["MIT"],
    homepage: "https://github.com/php-fig/log",
    require: { php: ">=8.0.0" },
    extra: { "branch-alias": { "dev-master": "3.x-dev" } },
    "notification-url": "https://packagist.org/downloads/",
  });
  expect(rec).toEqual({
    name: "psr/log",
    version: "3.0.2",
    versionNormalized: "3.0.2.0",
    license: "MIT",
    homepage: "https://github.com/php-fig/log",
    phpVersion: ">=8.0.0",
    branchAliases: { "dev-master": "3.x-dev" },
    fromPackagist: true,
  });
  const local = decodePackageRecord({
    name: "a/b",
    version: "dev-main",
    version_normalized: "dev-main",
    dist: { type: "path" },
  })!;
  expect(local).toMatchObject({
    versionNormalized: "dev-main",
    fromPackagist: false,
    branchAliases: {},
  });
  expect(local.license).toBeUndefined();
  expect(
    decodePackageRecord({ name: "a/b", version: "1.0" }, { fromPackagist: true })
  ).toMatchObject({ versionNormalized: "1.0.0.0", fromPackagist: true });
  expect(decodePackageRecord({ name: "a/b" })).toBeUndefined();
  expect(decodePackageRecord({ name: "a/b", version: "not a version" })).toBeUndefined();
  expect(decodePackageRecord("nope")).toBeUndefined();
});

test("Composer license arrays are disjunctive", () => {
  expect(combineLicenses(["MIT"])).toBe("MIT");
  expect(combineLicenses(["LGPL-2.1-only", "GPL-3.0-or-later"])).toBe(
    "LGPL-2.1-only OR GPL-3.0-or-later"
  );
  expect(combineLicenses(["MIT", " MIT "])).toBe("MIT");
  expect(combineLicenses("(MIT or GPL-2.0)")).toBe("(MIT or GPL-2.0)");
  expect(combineLicenses("proprietary")).toBe("proprietary");
  expect(combineLicenses([])).toBeUndefined();
  expect(combineLicenses("")).toBeUndefined();
  expect(combineLicenses(undefined)).toBeUndefined();
  expect(combineLicenses([42])).toBeUndefined();
});

test("a dev record satisfies through its aliases, a stale numeric record does not", () => {
  const dev = decodePackageRecord({
    name: "a/b",
    version: "dev-master",
    extra: { "branch-alias": { "dev-master": "2.0.x-dev" } },
  })!;
  const c = (s: string) => parseConstraint(s) as ValidConstraint;
  expect(recordSatisfies(dev, c("^2.0"), [])).toBe(true); // extra.branch-alias
  expect(recordSatisfies(dev, c("^3.0"), [])).toBe(false);
  expect(recordSatisfies(dev, c("^3.0"), ["3.0.0.0"])).toBe(true); // composer.lock aliases
  expect(recordSatisfies(dev, c("dev-master as 3.1.0"), [])).toBe(true); // the branch itself
  expect(recordSatisfies(dev, c("dev-other as 2.0.0"), [])).toBe(false); // alias of another branch
  expect(recordSatisfies(dev, c("dev-other"), [])).toBe(false);
  const old = decodePackageRecord({ name: "a/b", version: "1.2.0" })!;
  expect(recordSatisfies(old, c("^1.0"), [])).toBe(true);
  expect(recordSatisfies(old, c("^2.0"), ["9.0.0.0"])).toBe(false); // aliases only apply to dev records
  expect(packagePageUrl("psr/log", "3.0.2")).toBe("https://packagist.org/packages/psr/log#3.0.2");
});

// --- installed.ts / lockfile.ts ----------------------------------------------

const lockText = readFileSync(join(fixtures, "composer.composer.lock"), "utf8");
const installedText = readFileSync(join(fixtures, "composer.installed.json"), "utf8");

test("composer.lock indexes packages and packages-dev with licenses, and rejects other JSON", () => {
  const lock = parseLock(lockText)!;
  expect(lock.packages.get("psr/log")).toMatchObject({
    version: "3.0.2",
    license: "MIT",
    fromPackagist: true,
    phpVersion: ">=8.0.0",
  });
  expect(lock.packages.get("psr/container")?.license).toBe("MIT"); // from packages-dev
  expect(lock.packages.get("psr/http-message")).toMatchObject({
    version: "dev-master",
    branchAliases: { "dev-master": "2.0.x-dev" },
  });
  expect(lock.aliases.get("psr/log")).toBeUndefined();
  expect(
    parseLock(
      JSON.stringify({
        packages: [],
        aliases: [
          { package: "a/b", version: "dev-main", alias: "1.0.0", alias_normalized: "1.0.0.0" },
        ],
      })
    )!.aliases.get("a/b")
  ).toEqual(["1.0.0.0"]);
  expect(parseLock('{"name":"x"}')).toBeUndefined();
  expect(parseLock("not json")).toBeUndefined();
});

test("installed.json is read from the configured vendor dir, in Composer 2 and 1 shapes, without walking up", async () => {
  const files = new Map([
    ["/repo/vendor/composer/installed.json", installedText],
    [
      "/repo/lib/composer/installed.json",
      JSON.stringify([{ name: "a/b", version: "1.0.0", license: ["BSD-2-Clause"] }]),
    ],
  ]);
  const lookup = new InstalledLookup(fakeHost(files).fs);
  const dir = fakeUri("/repo");
  expect((await lookup.find(dir, "vendor", "psr/log"))?.license).toBe("MIT");
  expect((await lookup.find(dir, "vendor", "psr/http-message"))?.version).toBe("dev-master");
  expect((await lookup.find(dir, "lib", "a/b"))?.license).toBe("BSD-2-Clause"); // Composer 1 bare array
  expect(await lookup.find(dir, "vendor", "acme/missing")).toBeUndefined();
  expect(await lookup.find(fakeUri("/repo/sub"), "vendor", "psr/log")).toBeUndefined(); // no walk up
  files.delete("/repo/vendor/composer/installed.json");
  expect((await lookup.find(dir, "vendor", "psr/log"))?.license).toBe("MIT"); // 15 s TtlCache still answers
  lookup.invalidate();
  expect(await lookup.find(dir, "vendor", "psr/log")).toBeUndefined();
});

// --- client.ts --------------------------------------------------------------

test("minified expansion honours __unset and inheritance", () => {
  expect(
    expandMinified([
      { name: "a/b", version: "2.0.0", license: ["MIT"], homepage: "h" },
      { version: "1.9.0", license: "__unset" },
      { version: "1.8.0" },
    ])
  ).toEqual([
    { name: "a/b", version: "2.0.0", license: ["MIT"], homepage: "h" },
    { name: "a/b", version: "1.9.0", homepage: "h" },
    { name: "a/b", version: "1.8.0", homepage: "h" },
  ]);
  expect(expandMinified([{ version: "1.0" }, "garbage", { version: "0.9" }])).toEqual([
    { version: "1.0" },
    { version: "0.9" },
  ]);
});

test("candidate selection follows minimum-stability, prefer-stable and flags", () => {
  const v = (version: string) =>
    decodePackageRecord({ name: "a/b", version }, { fromPackagist: true })!;
  const list = [
    v("2.1.0-beta1"),
    v("2.0.0"),
    v("1.5.0"),
    v("2.0.0-RC1"),
    v("1.0.0-alpha1"),
    v("dev-main"),
  ];
  const c = (s: string) => parseConstraint(s) as ValidConstraint;
  expect(selectVersion(list, c("^2.0"), "stable", false)?.version).toBe("2.0.0");
  expect(selectVersion(list, c("^2.0"), "beta", false)?.version).toBe("2.1.0-beta1");
  expect(selectVersion(list, c("^2.0"), "beta", true)?.version).toBe("2.0.0");
  expect(selectVersion(list, c("^2.0@beta"), "stable", false)?.version).toBe("2.1.0-beta1");
  expect(selectVersion(list, c("^2.0@RC"), "beta", false)?.version).toBe("2.0.0"); // a flag replaces the floor, even upward
  expect(selectVersion(list, c("2.1.0-beta1"), "stable", false)?.version).toBe("2.1.0-beta1"); // implied stability
  expect(selectVersion(list, c("^3.0"), "dev", false)).toBeUndefined();
  expect(selectVersion(list, c("*"), "dev", false)?.version).toBe("2.1.0-beta1"); // branches are never candidates
  expect(selectVersion(list, c("^1.0"), "stable", false)?.version).toBe("1.5.0");
});

test("Packagist client caches expanded lists, surfaces 404, and stands down after 429", async () => {
  let now = 1_000_000;
  const standDown = new StandDown(() => now);
  const { calls, restore } = mountPackagist({
    "psr/log": [
      {
        name: "psr/log",
        version: "3.0.2",
        version_normalized: "3.0.2.0",
        license: ["MIT"],
        require: { php: ">=8.0.0" },
      },
      { version: "3.0.1", version_normalized: "3.0.1.0" },
    ],
    "acme/limited": 429,
  });
  const cache = makeCache();
  try {
    const client = new PackagistClient(cache, standDown);
    const found = await client.versions("psr/log", noCancel);
    expect(found.kind).toBe("found");
    if (found.kind !== "found") return;
    expect(
      found.versions.map((v) => [v.version, v.license, v.phpVersion, v.fromPackagist])
    ).toEqual([
      ["3.0.2", "MIT", ">=8.0.0", true],
      ["3.0.1", "MIT", ">=8.0.0", true],
    ]);
    expect(calls).toEqual(["https://repo.packagist.org/p2/psr/log.json"]);
    expect(await client.versions("psr/log", noCancel)).toEqual(found); // cached: nothing sent
    expect(calls.length).toBe(1);
    expect(await client.versions("acme/missing", noCancel)).toEqual({
      kind: "unknown",
      reason: "not found on Packagist",
    });
    expect(await new PackagistClient(cache, standDown).versions("acme/missing", noCancel)).toEqual({
      kind: "unknown",
      reason: "not found on Packagist",
    }); // a miss is not cached
    expect(calls.length).toBe(3);

    expect((await client.versions("acme/limited", noCancel)).kind).toBe("unknown");
    const paused = await new PackagistClient(cache, standDown).versions("acme/other", noCancel);
    expect(paused).toEqual({ kind: "unknown", reason: "Packagist requests paused after HTTP 429" });
    expect(calls.length).toBe(4); // the paused call sent nothing
    now += 60_001;
    await client.versions("acme/other", noCancel);
    expect(calls.length).toBe(5);
  } finally {
    restore();
    cache.dispose();
  }
});

test("with composer.useRegistry off, only cached lists answer", async () => {
  setSettings({ "packageLicenseViewer.composer.useRegistry": false });
  const { calls, restore } = mountPackagist({ "psr/log": [{ name: "psr/log", version: "3.0.2" }] });
  const cache = makeCache();
  try {
    const client = new PackagistClient(cache, new StandDown());
    expect(await client.versions("psr/log", noCancel)).toEqual({
      kind: "unknown",
      reason: "Packagist lookups are disabled",
    });
    cache.set("composer:packagist:v1:psr/log", [
      decodePackageRecord(
        { name: "psr/log", version: "3.0.2", license: ["MIT"] },
        { fromPackagist: true }
      ),
    ]);
    expect((await client.versions("psr/log", noCancel)).kind).toBe("found");
    expect(calls).toEqual([]);
  } finally {
    restore();
    cache.dispose();
  }
});

// --- phpVersion display -----------------------------------------------------

test("phpVersion is appended like goVersion and shown in the hover", () => {
  const entry = { name: "psr/log", spec: "^3.0", section: "require", line: 0 };
  const info = {
    source: "local" as const,
    license: "MIT",
    version: "3.0.2",
    phpVersion: ">=8.0.0",
  };
  expect(formatAnnotationSegments(getConfig(), entry, info)?.after).toContain("(PHP: >=8.0.0)");
  expect(buildHover(entry, info)?.value).toContain("PHP: `>=8.0.0`");
  setSettings({ "packageLicenseViewer.showPhpVersion": false });
  invalidateConfigCache();
  expect(formatAnnotationSegments(getConfig(), entry, info)?.after ?? "").not.toContain("PHP");
  setSettings({ "packageLicenseViewer.format": "${license} php ${phpVersion}" });
  invalidateConfigCache();
  expect(formatAnnotationSegments(getConfig(), entry, info)?.after).toBe(" php >=8.0.0");
});

// --- the provider -----------------------------------------------------------

const PACKAGIST = "https://packagist.org/downloads/";
const lockWith = (packages: unknown[], dev: unknown[] = []) =>
  JSON.stringify({ packages, "packages-dev": dev, aliases: [] });
const installedWith = (packages: unknown[]) => JSON.stringify({ packages, dev: true });

test("Composer resolution prefers vendor, then composer.lock, then Packagist", async () => {
  const files = new Map([
    [
      "/repo/vendor/composer/installed.json",
      installedWith([
        {
          name: "psr/log",
          version: "3.0.2",
          license: ["MIT"],
          require: { php: ">=8.0.0" },
          homepage: "https://github.com/php-fig/log",
          "notification-url": PACKAGIST,
        },
      ]),
    ],
    [
      "/repo/composer.lock",
      lockWith(
        [{ name: "psr/log", version: "3.0.2", license: ["MIT"], "notification-url": PACKAGIST }],
        [
          {
            name: "psr/container",
            version: "2.0.2",
            license: ["MIT"],
            "notification-url": PACKAGIST,
          },
        ]
      ),
    ],
  ]);
  const { calls, restore } = mountPackagist({
    "acme/remote": [
      { name: "acme/remote", version: "1.2.0", version_normalized: "1.2.0.0", license: ["MIT"] },
      { version: "1.1.0", version_normalized: "1.1.0.0" },
    ],
  });
  const cache = makeCache();
  try {
    const provider = new ComposerLicenseProvider(cache, fakeHost(files));
    const document = fakeDocument(
      JSON.stringify({
        require: { "psr/log": "^3.0", "acme/remote": "^1.0", "acme/missing": "^1.0" },
        "require-dev": { "psr/container": "^2.0" },
      }),
      "/repo/composer.json"
    );
    const entries = provider.parse(document);
    expect(entries.map((e) => e.name)).toEqual([
      "psr/log",
      "acme/remote",
      "acme/missing",
      "psr/container",
    ]);
    const resolved = [];
    for (const entry of entries) resolved.push(await provider.resolve(entry, document, noCancel));

    expect({ ...resolved[0] }).toEqual({
      source: "local",
      license: "MIT",
      version: "3.0.2",
      phpVersion: ">=8.0.0",
      homepage: "https://github.com/php-fig/log",
      packagePageUrl: "https://packagist.org/packages/psr/log#3.0.2",
    });
    expect(resolved[1]).toMatchObject({
      source: "registry",
      via: "packagist.org",
      license: "MIT",
      version: "1.2.0",
      packagePageUrl: "https://packagist.org/packages/acme/remote#1.2.0",
    });
    expect(resolved[2]).toEqual({ source: "unknown", detail: "not found on Packagist" });
    expect(resolved[3]).toMatchObject({ source: "lockfile", via: "composer.lock", license: "MIT" });
    expect(calls).toEqual([
      "https://repo.packagist.org/p2/acme/remote.json",
      "https://repo.packagist.org/p2/acme/missing.json",
    ]);
    expect(buildHover(entries[1], resolved[1])!.value).toMatch(
      /\[`acme\/remote@1\.2\.0`\]\(https:\/\/packagist\.org\/packages\/acme\/remote#1\.2\.0\)/
    );
    // The expanded list is cached, so asking again sends nothing
    calls.length = 0;
    expect((await provider.resolve(entries[1], document, noCancel)).license).toBe("MIT");
    expect(calls).toEqual([]);
  } finally {
    restore();
    cache.dispose();
  }
});

test("a stale vendor or lock version falls through instead of lying", async () => {
  const files = new Map([
    [
      "/repo/vendor/composer/installed.json",
      installedWith([{ name: "psr/log", version: "2.0.0", license: ["MIT"] }]),
    ],
    ["/repo/composer.lock", lockWith([{ name: "psr/log", version: "2.0.0", license: ["MIT"] }])],
  ]);
  const { restore } = mountPackagist({
    "psr/log": [
      { name: "psr/log", version: "3.0.2", version_normalized: "3.0.2.0", license: ["MIT"] },
    ],
  });
  const cache = makeCache();
  try {
    const provider = new ComposerLicenseProvider(cache, fakeHost(files));
    const document = fakeDocument('{"require":{"psr/log":"^3.0"}}', "/repo/composer.json");
    const [entry] = provider.parse(document);
    expect(await provider.resolve(entry, document, noCancel)).toMatchObject({
      source: "registry",
      version: "3.0.2",
    });
  } finally {
    restore();
    cache.dispose();
  }
});

test("a path-repository package has no title link, and a dev branch is reported from the lock only", async () => {
  const files = new Map([
    [
      "/repo/composer.lock",
      lockWith([
        {
          name: "acme/local",
          version: "dev-main",
          license: ["MIT"],
          dist: { type: "path", url: "../local" },
        },
        {
          name: "acme/branch",
          version: "dev-main",
          license: ["Apache-2.0"],
          extra: { "branch-alias": { "dev-main": "1.x-dev" } },
          "notification-url": PACKAGIST,
        },
      ]),
    ],
  ]);
  const { calls, restore } = mountPackagist({});
  const cache = makeCache();
  try {
    const provider = new ComposerLicenseProvider(cache, fakeHost(files));
    const document = fakeDocument(
      JSON.stringify({
        require: { "acme/local": "dev-main", "acme/branch": "^1.0", "acme/other": "dev-feature" },
      }),
      "/repo/composer.json"
    );
    const entries = provider.parse(document);
    const [local, branch, other] = await Promise.all(
      entries.map((entry) => provider.resolve(entry, document, noCancel))
    );
    expect(local).toMatchObject({ source: "lockfile", license: "MIT", version: "dev-main" });
    expect(local.packagePageUrl).toBeUndefined();
    expect(branch).toMatchObject({
      source: "lockfile",
      license: "Apache-2.0",
      version: "dev-main",
      packagePageUrl: "https://packagist.org/packages/acme/branch#dev-main",
    });
    expect(other).toEqual({
      source: "unknown",
      detail: "branch requirements resolve only from vendor/ or composer.lock",
    });
    expect(calls).toEqual([]);
  } finally {
    restore();
    cache.dispose();
  }
});

test("platform, invalid, disabled-Packagist and unparseable requirements never reach the network", async () => {
  const files = new Map([
    ["/repo/composer.lock", lockWith([{ name: "acme/x", version: "1.0.0", license: ["MIT"] }])],
  ]);
  const { calls, restore } = mountPackagist({});
  const cache = makeCache();
  try {
    const provider = new ComposerLicenseProvider(cache, fakeHost(files));
    const document = fakeDocument(
      JSON.stringify({
        require: {
          php: ">=8.1",
          "ext-json": "*",
          "not-a-name": "1.0",
          "acme/x": "~>1.0",
          "acme/y": "^1.0",
          "acme/z": "~>2.0",
        },
        repositories: [{ "packagist.org": false }],
      }),
      "/repo/composer.json"
    );
    const entries = provider.parse(document);
    expect(entries.map((e) => e.name)).toEqual(["not-a-name", "acme/x", "acme/y", "acme/z"]);
    const infos = [];
    for (const entry of entries) infos.push(await provider.resolve(entry, document, noCancel));
    expect(infos[0]).toEqual({ source: "unknown", detail: "invalid package name" });
    // Locked, so reported even though the constraint cannot be checked
    expect(infos[1]).toMatchObject({
      source: "lockfile",
      license: "MIT",
      detail: "version constraint could not be checked",
    });
    expect(infos[2]).toEqual({
      source: "unknown",
      detail: "Packagist is disabled in composer.json",
    });
    expect(infos[3]).toEqual({ source: "unknown", detail: "unsupported version constraint" });
    expect(calls).toEqual([]);
  } finally {
    restore();
    cache.dispose();
  }
});

test("with composer.useLockfiles off, the lock is skipped", async () => {
  setSettings({
    "packageLicenseViewer.composer.useLockfiles": false,
    "packageLicenseViewer.composer.useRegistry": false,
  });
  const files = new Map([
    ["/repo/composer.lock", lockWith([{ name: "acme/x", version: "1.0.0", license: ["MIT"] }])],
  ]);
  const cache = makeCache();
  const provider = new ComposerLicenseProvider(cache, fakeHost(files));
  const document = fakeDocument('{"require":{"acme/x":"^1.0"}}', "/repo/composer.json");
  const [entry] = provider.parse(document);
  expect(await provider.resolve(entry, document, noCancel)).toEqual({
    source: "unknown",
    detail: "Packagist lookups are disabled",
  });
  cache.dispose();
});

test("supports recognizes project manifests only, and cache keys keep manifests apart", () => {
  const cache = makeCache();
  const provider = new ComposerLicenseProvider(cache, fakeHost());
  cache.dispose();
  expect(provider.id).toBe("composer");
  expect(provider.supports(fakeDocument("", "/r/composer.json"))).toBe(true);
  expect(provider.supports(fakeDocument("", "/r/sub/composer.json"))).toBe(true);
  expect(provider.supports(fakeDocument("", "/r/vendor/x/y/composer.json"))).toBe(false);
  expect(provider.supports(fakeDocument("", "/r/composer.lock"))).toBe(false);
  expect(provider.supports(fakeDocument("", "/r/package.json"))).toBe(false);
  const of = (path: string, text: string) =>
    provider.cacheKey(provider.parse(fakeDocument(text, path))[0]);
  expect(of("/a/composer.json", '{"require":{"acme/x":"^1.0"}}')).not.toBe(
    of("/b/composer.json", '{"require":{"acme/x":"^1.0"}}')
  );
  expect(of("/a/composer.json", '{"require":{"acme/x":"^1.0"}}')).not.toBe(
    of("/a/composer.json", '{"require":{"acme/x":"^2.0"}}')
  );
  expect(of("/a/composer.json", '{"require":{"acme/x":"^1.0"}}')).toBe(
    of("/a/composer.json", '{"require-dev":{"acme/x":"^1.0"}}')
  );
  expect(provider.cacheKey({ name: "acme/x", spec: "^1.0", section: "require", line: 0 })).toBe(
    "composer:invalid:acme/x"
  );
});
