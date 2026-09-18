import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { LicenseCache } from "../src/cache";
import type { ViewerConfig } from "../src/config";
import { buildHover, formatAnnotation, formatAnnotationSegments } from "../src/format";
import type { LicenseInfo } from "../src/providers/types";
import * as lock from "../src/providers/npm/lockfile/parsers";
import { normalizeLicense, normalizeNodeEngine } from "../src/providers/npm/manifest";
import { parsePackageJson } from "../src/providers/npm/parse";
import { parsePnpmWorkspaceYaml } from "../src/providers/npm/pnpmWorkspace";
import { NpmLicenseProvider } from "../src/providers/npm";
import { encodePackageName, parseSpec } from "../src/providers/npm/spec";
import { parseJsrNpmCompatName, parseJsrPackageName } from "../src/providers/jsr/client";
import { isDenoManifest, parseDenoManifest, parseDenoSpecifier } from "../src/providers/jsr/parse";
import { fakeDocument, fakeHost, fakeUri } from "./support/fakeHost";

declare const __dirname: string;

const noCancel = {
  isCancellationRequested: false,
  onCancellationRequested: (listener: (e: unknown) => unknown) => {
    void listener;
    return { dispose() {} };
  },
};

const FIXTURES = join(__dirname, "..", "..", "..", "test", "fixtures", "lockfiles");
const readFixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

// --- version specifiers -----------------------------------------------------

test("parseSpec classifies npm version specifiers", () => {
  const kindOf = (spec: string) => parseSpec("pkg", spec).kind;

  expect(kindOf("^4.17.21")).toBe("range");
  expect(kindOf("4.17.21")).toBe("range");
  expect(kindOf(">=1.0.0 <2.0.0")).toBe("range");
  expect(kindOf("1.x || 2.x")).toBe("range");
  expect(kindOf("*")).toBe("tag");
  expect(kindOf("")).toBe("tag");
  expect(kindOf("next")).toBe("tag");

  for (const spec of [
    "file:../local",
    "link:../local",
    "workspace:*",
    "portal:../x",
    "patch:x@1.0.0#./p.patch",
    "git+https://github.com/u/r.git",
    "github:u/r",
    "https://example.com/x.tgz",
    "user/repo",
    "user/repo#v1.0.0",
  ]) {
    expect(kindOf(spec), `${spec} should be unresolvable`).toBe("unresolvable");
  }
});

// pnpm workspace catalogs write the specifier verbatim into package.json — verified against a real `pnpm add` with a `catalog:` entry in pnpm-workspace.yaml.
test("parseSpec recognises pnpm workspace catalog references", () => {
  expect({ ...parseSpec("typescript", "catalog:") }).toEqual({
    kind: "catalog",
    name: "typescript",
    spec: "catalog:",
  });
  expect({ ...parseSpec("typescript", "catalog:build") }).toEqual({
    kind: "catalog",
    name: "typescript",
    spec: "catalog:build",
  });
});

test("parseSpec follows npm: aliases to their target", () => {
  expect({ ...parseSpec("lodash4", "npm:lodash@^4.0.0") }).toEqual({
    kind: "range",
    name: "lodash",
    spec: "^4.0.0",
  });
  expect({ ...parseSpec("x", "npm:@scope/pkg@1.2.3") }).toEqual({
    kind: "range",
    name: "@scope/pkg",
    spec: "1.2.3",
  });
  // No version means latest
  expect(parseSpec("x", "npm:lodash").spec).toBe("latest");
});

// pnpm >=10.9 and Yarn >=4.9 write these two shapes for JSR packages — verified by actually running `pnpm add jsr:@luca/cases` and `pnpm add cases-alias@jsr:@luca/cases`.
test("parseSpec recognises the jsr: specifier pnpm/Yarn write", () => {
  // bare form: the package.json key is itself the JSR name — "@luca/cases": "jsr:^1.0.0"
  expect({ ...parseSpec("@luca/cases", "jsr:^1.0.0") }).toEqual({
    kind: "jsr",
    name: "@luca/cases",
    spec: "^1.0.0",
  });
  // aliased form: the JSR name lives in the value — "cases-alias": "jsr:@luca/cases@^1.0.0"
  expect({ ...parseSpec("cases-alias", "jsr:@luca/cases@^1.0.0") }).toEqual({
    kind: "jsr",
    name: "@luca/cases",
    spec: "^1.0.0",
  });
  // No version means latest, for both forms
  expect(parseSpec("@luca/cases", "jsr:").spec).toBe("latest");
  expect(parseSpec("x", "jsr:@luca/cases").spec).toBe("latest");
});

test("resolve() skips a jsr: specifier whose name is not scoped, rather than sending it to npmjs.org", async () => {
  const provider = new NpmLicenseProvider(new LicenseCache(memoryMemento()), fakeHost());
  const document = fakeDocument("{}", "/project/package.json");
  const info = await provider.resolve(
    { name: "not-scoped", spec: "jsr:^1.0.0", section: "dependencies", line: 0 },
    document,
    noCancel
  );
  expect(info.source).toBe("skipped");
});

// A `catalog:` reference has no version of its own to send to npmjs.org — only pnpm-lock.yaml's importers section knows what it resolved to. Previously it was misclassified as `unresolvable` (alongside file:/workspace:/git) and silently skipped instead of ever being looked up there (issue #1).
test("resolve() reports a catalog: reference as unknown, not skipped, when no lockfile answers it", async () => {
  const provider = new NpmLicenseProvider(new LicenseCache(memoryMemento()), fakeHost());
  const document = fakeDocument("{}", "/project/package.json");
  const info = await provider.resolve(
    { name: "typescript", spec: "catalog:", section: "devDependencies", line: 0 },
    document,
    noCancel
  );
  expect(info.source).toBe("unknown");
  expect(info.detail).toMatch(/catalog/);
});

// The hover title lost its npmjs.org link for a catalog: dependency that resolves straight from node_modules (issue #2). registryPackageName has to be set on this path too, not just the lockfile path, since a catalog reference names a real npm package just as much as a plain semver range does.
test("resolve() links a catalog: dependency resolved from node_modules to npmjs.org", async () => {
  const host = fakeHost({
    "/project/node_modules/@types/node/package.json": JSON.stringify({
      name: "@types/node",
      version: "22.20.1",
      license: "MIT",
    }),
  });
  const provider = new NpmLicenseProvider(new LicenseCache(memoryMemento()), host);
  const document = fakeDocument("{}", "/project/package.json");
  const info = await provider.resolve(
    { name: "@types/node", spec: "catalog:", section: "devDependencies", line: 0 },
    document,
    noCancel
  );
  expect(info.license).toBe("MIT");
  expect(info.registryPackageName).toBe("@types/node");
});

// issue #4: an installed package's engines.node should reach the hover.
test("resolve() surfaces engines.node from an installed package", async () => {
  const host = fakeHost({
    "/project/node_modules/typescript/package.json": JSON.stringify({
      name: "typescript",
      version: "5.6.3",
      license: "Apache-2.0",
      engines: { node: ">=14.17" },
    }),
  });
  const provider = new NpmLicenseProvider(new LicenseCache(memoryMemento()), host);
  const document = fakeDocument("{}", "/project/package.json");
  const info = await provider.resolve(
    { name: "typescript", spec: "^5.0.0", section: "dependencies", line: 0 },
    document,
    noCancel
  );
  expect(info.nodeEngine).toBe(">=14.17");
});

test("encodePackageName encodes the scope separator", () => {
  expect(encodePackageName("@babel/core")).toBe("@babel%2fcore");
  expect(encodePackageName("lodash")).toBe("lodash");
});

// --- license field normalisation --------------------------------------------

test("normalizeLicense handles every historical shape", () => {
  expect(normalizeLicense({ license: "MIT" })).toBe("MIT");
  expect(normalizeLicense({ license: { type: "ISC" } })).toBe("ISC");
  expect(normalizeLicense({ licenses: [{ type: "MIT" }] })).toBe("MIT");
  expect(normalizeLicense({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] })).toBe(
    "(MIT OR Apache-2.0)"
  );
  expect(normalizeLicense({ license: "  " })).toBeUndefined();
  expect(normalizeLicense({})).toBeUndefined();
  expect(normalizeLicense(undefined)).toBeUndefined();
});

// issue #4: engines.node should surface in the hover, right after the license.
test("normalizeNodeEngine reads engines.node", () => {
  expect(normalizeNodeEngine({ engines: { node: ">=18.0.0" } })).toBe(">=18.0.0");
  expect(normalizeNodeEngine({ engines: { node: "  " } })).toBeUndefined();
  expect(normalizeNodeEngine({ engines: {} })).toBeUndefined();
  expect(normalizeNodeEngine({})).toBeUndefined();
  expect(normalizeNodeEngine(undefined)).toBeUndefined();
});

// --- parsing package.json ---------------------------------------------------

const PACKAGE_JSON = `{
  "name": "demo",
  "dependencies": {
    "lodash": "^4.17.21",
    "@babel/core": "7.24.0"
  },
  "devDependencies": {
    "typescript": "~5.7.0"
  },
  "peerDependenciesMeta": {
    "typescript": { "optional": true }
  },
  "customDependencies": {
    "left-pad": "1.3.0"
  },
  "scripts": { "build": "tsc" }
}`;

const ALL_SECTIONS = {
  sections: ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"],
  autoDetectSections: true,
};

test("parsePackageJson finds dependencies with their line numbers", () => {
  const entries = parsePackageJson(fakeDocument(PACKAGE_JSON), ALL_SECTIONS);
  expect(entries.map((e) => `${e.section}/${e.name}@${e.spec}#${e.line}`)).toEqual([
    "dependencies/lodash@^4.17.21#3",
    "dependencies/@babel/core@7.24.0#4",
    "devDependencies/typescript@~5.7.0#7",
    "customDependencies/left-pad@1.3.0#13",
  ]);
});

test("parsePackageJson ignores non-string values such as peerDependenciesMeta", () => {
  const entries = parsePackageJson(fakeDocument(PACKAGE_JSON), ALL_SECTIONS);
  expect(entries.filter((e) => e.section === "peerDependenciesMeta")).toHaveLength(0);
});

test("parsePackageJson respects autoDetectSections", () => {
  const entries = parsePackageJson(fakeDocument(PACKAGE_JSON), {
    sections: ["dependencies"],
    autoDetectSections: false,
  });
  expect(entries.map((e) => e.name)).toEqual(["lodash", "@babel/core"]);
});

test("parsePackageJson keeps working while the JSON is half-typed", () => {
  const entries = parsePackageJson(fakeDocument(`{ "dependencies": { "a": "^1.0.0", "b": `), {
    sections: ["dependencies"],
    autoDetectSections: false,
  });
  expect(entries.map((e) => e.name)).toEqual(["a"]);
});

// --- pnpm-workspace.yaml catalogs -------------------------------------------
// The versions declared here are the real thing (issue #3): ordinary ranges resolved exactly like any other dependency, just parsed out of YAML instead of a package.json.

test("parsePnpmWorkspaceYaml reads the default catalog", () => {
  const yaml = [
    "packages:",
    "  - 'packages/*'",
    "",
    "catalog:",
    "  react: ^18.3.1",
    "  '@types/node': ^22.0.0",
    "  typescript: 5.6.3",
    "",
  ].join("\n");
  const entries = parsePnpmWorkspaceYaml(fakeDocument(yaml, "/repo/pnpm-workspace.yaml"));
  expect(entries.map((e) => [e.name, e.spec, e.section])).toEqual([
    ["react", "^18.3.1", "catalog"],
    ["@types/node", "^22.0.0", "catalog"],
    ["typescript", "5.6.3", "catalog"],
  ]);
});

test("parsePnpmWorkspaceYaml reads named catalogs separately", () => {
  const yaml = [
    "catalogs:",
    "  react17:",
    "    react: ^17.0.2",
    "    react-dom: ^17.0.2",
    "  build:",
    "    typescript: ^5.4.0",
    "",
  ].join("\n");
  const entries = parsePnpmWorkspaceYaml(fakeDocument(yaml, "/repo/pnpm-workspace.yaml"));
  expect(entries.map((e) => [e.name, e.spec, e.section])).toEqual([
    ["react", "^17.0.2", "catalogs.react17"],
    ["react-dom", "^17.0.2", "catalogs.react17"],
    ["typescript", "^5.4.0", "catalogs.build"],
  ]);
});

test("parsePnpmWorkspaceYaml ignores unrelated top-level sections", () => {
  const yaml = ["packages:", "  - 'apps/*'", "", "catalog:", "  lodash: ^4.17.21", ""].join("\n");
  const entries = parsePnpmWorkspaceYaml(fakeDocument(yaml, "/repo/pnpm-workspace.yaml"));
  expect(entries.map((e) => e.name)).toEqual(["lodash"]);
});

test("NpmLicenseProvider.supports recognises pnpm-workspace.yaml, not other yaml files", () => {
  const provider = new NpmLicenseProvider(new LicenseCache(memoryMemento()), fakeHost());
  expect(provider.supports(fakeDocument("catalog:\n", "/repo/pnpm-workspace.yaml"))).toBe(true);
  expect(provider.supports(fakeDocument("foo: bar\n", "/repo/other.yaml"))).toBe(false);
});

// --- Deno / JSR -------------------------------------------------------------

test("isDenoManifest recognises the manifest file names", () => {
  for (const name of ["deno.json", "deno.jsonc", "jsr.json", "import_map.json"]) {
    expect(isDenoManifest(fakeUri(`/p/${name}`)), name).toBe(true);
  }
  expect(isDenoManifest(fakeUri("/p/package.json"))).toBe(false);
});

test("parseDenoSpecifier splits jsr: and npm: specifiers", () => {
  expect({ ...parseDenoSpecifier("jsr:@std/fs@^1.0.0") }).toEqual({
    kind: "jsr",
    name: "@std/fs",
    range: "^1.0.0",
  });
  expect({ ...parseDenoSpecifier("jsr:@std/fs") }).toEqual({
    kind: "jsr",
    name: "@std/fs",
    range: "latest",
  });
  expect({ ...parseDenoSpecifier("npm:chalk@^5.3.0") }).toEqual({
    kind: "npm",
    name: "chalk",
    range: "^5.3.0",
  });
  expect({ ...parseDenoSpecifier("npm:@scope/pkg@1.0.0") }).toEqual({
    kind: "npm",
    name: "@scope/pkg",
    range: "1.0.0",
  });
  // With a trailing subpath
  expect({ ...parseDenoSpecifier("npm:chalk@^5/lib/index.js") }).toEqual({
    kind: "npm",
    name: "chalk",
    range: "^5",
  });

  // Out of scope
  expect(parseDenoSpecifier("jsr:@std/fs/")).toBeUndefined();
  expect(parseDenoSpecifier("https://deno.land/std@0.220.0/fs/mod.ts")).toBeUndefined();
  expect(parseDenoSpecifier("node:fs")).toBeUndefined();
  expect(parseDenoSpecifier("./mod.ts")).toBeUndefined();
});

test("parseDenoManifest picks up only resolvable imports", () => {
  const text = `{
  "imports": {
    "@std/fs": "jsr:@std/fs@^1.0.0",
    "chalk": "npm:chalk@^5.3.0",
    "@std/fs/": "jsr:@std/fs/",
    "local": "./mod.ts"
  }
}`;
  const entries = parseDenoManifest(fakeDocument(text, "/p/deno.json"));
  expect(entries.map((e) => e.name)).toEqual(["@std/fs", "chalk"]);
  expect(entries[0].spec).toBe("jsr:@std/fs@^1.0.0");
  expect(entries[0].line).toBe(2);
});

test("parseDenoManifest also reads a bare import map", () => {
  const entries = parseDenoManifest(
    fakeDocument(`{ "@std/fs": "jsr:@std/fs@^1.0.0" }`, "/p/import_map.json")
  );
  expect(entries.map((e) => e.name)).toEqual(["@std/fs"]);
});

test("JSR package names convert to and from the npm-compat form", () => {
  expect({ ...parseJsrPackageName("@std/fs") }).toEqual({ scope: "std", name: "fs" });
  expect(parseJsrPackageName("lodash")).toBeUndefined();
  expect({ ...parseJsrNpmCompatName("@jsr/std__fs") }).toEqual({ scope: "std", name: "fs" });
  expect(parseJsrNpmCompatName("@babel/core")).toBeUndefined();
});

// --- lockfiles --------------------------------------------------------------
// The fixtures were produced by really installing with each package manager, so every one of them contains lodash@4.18.1 and @babel/code-frame@7.29.7.

describe.each([
  ["npm.package-lock.json", lock.parseNpmLock, "npm"],
  ["pnpm.pnpm-lock.yaml", lock.parsePnpmLock, "pnpm"],
  ["yarn-classic.yarn.lock", lock.parseYarnLock, "yarn"],
  ["yarn-berry.yarn.lock", lock.parseYarnLock, "yarn-berry"],
  ["bun.bun.lock", lock.parseBunLock, "bun"],
] as const)("lockfile: %s", (fixture, parse, expectedKind) => {
  test("resolves direct and transitive dependencies", () => {
    const index = parse(readFixture(fixture));
    expect(index.kind).toBe(expectedKind);

    expect(lock.lookupInIndex(index, "lodash", "^4.17.21")?.version).toBe("4.18.1");
    expect(lock.lookupInIndex(index, "@babel/code-frame", "^7.24.0")?.version).toBe("7.29.7");
    expect(lock.lookupInIndex(index, "js-tokens", "^4.0.0")?.version).toBe("4.0.0");
    expect(lock.lookupInIndex(index, "not-in-there", "^1.0.0")).toBeUndefined();
  });
});

test("lockfile: package-lock.json carries the license itself", () => {
  const index = lock.parseNpmLock(readFixture("npm.package-lock.json"));
  expect(lock.lookupInIndex(index, "lodash", "^4.17.21")?.license).toBe("MIT");
});

test("lockfile: npm lockfileVersion 1 nests dependencies", () => {
  const index = lock.parseNpmLock(
    JSON.stringify({
      lockfileVersion: 1,
      dependencies: {
        lodash: { version: "4.17.21" },
        chalk: { version: "2.0.0", dependencies: { "ansi-styles": { version: "3.2.1" } } },
      },
    })
  );
  expect(lock.lookupInIndex(index, "ansi-styles", "^3.0.0")?.version).toBe("3.2.1");
});

test("lockfile: npm workspaces put packages under a nested path", () => {
  const index = lock.parseNpmLock(
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": {},
        "packages/app/node_modules/left-pad": { version: "1.3.0", license: "WTFPL" },
        "packages/app": { link: true },
      },
    })
  );
  const hit = lock.lookupInIndex(index, "left-pad", "^1.0.0");
  expect(hit?.version).toBe("1.3.0");
  expect(hit?.license).toBe("WTFPL");
});

test("lockfile: the right version is chosen when several are present", () => {
  const index = lock.parseNpmLock(
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": {},
        "node_modules/semver": { version: "7.6.0" },
        "node_modules/foo/node_modules/semver": { version: "5.7.1" },
      },
    })
  );
  expect(lock.lookupInIndex(index, "semver", "^5.0.0")?.version).toBe("5.7.1");
  expect(lock.lookupInIndex(index, "semver", "^7.0.0")?.version).toBe("7.6.0");
});

test("lockfile: older pnpm key shapes still parse", () => {
  const v6 = lock.parsePnpmLock(
    `lockfileVersion: '6.0'\n\npackages:\n\n  /@babel/code-frame@7.24.0:\n    resolution: {integrity: sha512-x}\n`
  );
  expect(lock.lookupInIndex(v6, "@babel/code-frame", "^7.0.0")?.version).toBe("7.24.0");

  const v5 = lock.parsePnpmLock(
    `lockfileVersion: 5.4\n\npackages:\n\n  /lodash/4.17.21:\n    resolution: {integrity: sha512-x}\n`
  );
  expect(lock.lookupInIndex(v5, "lodash", "^4.0.0")?.version).toBe("4.17.21");

  const peers = lock.parsePnpmLock(
    `lockfileVersion: '9.0'\n\npackages:\n\n  '@vue/compiler@3.4.0(vue@3.4.0)':\n    resolution: {integrity: sha512-x}\n`
  );
  expect(lock.lookupInIndex(peers, "@vue/compiler", "^3.0.0")?.version).toBe("3.4.0");
});

// pnpm records a catalog dependency's specifier verbatim (`catalog:`, or `catalog:<name>` for a named catalog) next to the version it actually resolved to — same shape as any other importer entry, just with a specifier that isn't a semver range (issue #1).
test("lockfile: pnpm records what a workspace catalog reference resolved to", () => {
  const index = lock.parsePnpmLock(
    [
      "lockfileVersion: '9.0'",
      "",
      "importers:",
      "",
      "  .:",
      "    devDependencies:",
      "      typescript:",
      "        specifier: catalog:",
      "        version: 5.6.3",
      "      vitest:",
      "        specifier: catalog:test",
      "        version: 2.1.5",
      "",
    ].join("\n")
  );
  expect(lock.lookupInIndex(index, "typescript", "catalog:")?.version).toBe("5.6.3");
  expect(lock.lookupInIndex(index, "vitest", "catalog:test")?.version).toBe("2.1.5");
});

// `catalog:` isn't a semver range, so unlike a normal specifier it must never fall back to "the only same-named version pinned anywhere in the lockfile" — that version could be an unrelated transitive dependency's, not what the catalog actually resolved to.
test("lockfile: a catalog: specifier never falls back to an unrelated same-named version", () => {
  const index = lock.parsePnpmLock(
    [
      "lockfileVersion: '9.0'",
      "",
      "packages:",
      "",
      "  typescript@5.4.2:",
      "    resolution: {integrity: sha512-x}",
      "",
    ].join("\n")
  );
  expect(lock.lookupInIndex(index, "typescript", "catalog:")).toBeUndefined();
});

test("lockfile: a yarn heading may list several specifiers", () => {
  const index = lock.parseYarnLock(
    `lodash@^4.0.0, lodash@^4.17.21:\n  version "4.17.21"\n  resolved "https://x"\n`
  );
  expect(lock.lookupInIndex(index, "lodash", "^4.0.0")?.version).toBe("4.17.21");
  expect(lock.lookupInIndex(index, "lodash", "^4.17.21")?.version).toBe("4.17.21");
});

test("lockfile: bun nests packages under a composite key", () => {
  const index = lock.parseBunLock(
    `{"packages":{"parent/lodash":["lodash@4.17.21","",{},"sha512-x"],}}`
  );
  expect(lock.lookupInIndex(index, "lodash", "^4.0.0")?.version).toBe("4.17.21");
});

// --- rendering --------------------------------------------------------------

const BASE_CONFIG: ViewerConfig = {
  enabled: true,
  format: "${license}",
  showResolvedVersion: false,
  showNodeEngine: true,
  unknownText: "",
  annotationColor: "editorCodeLens.foreground",
  licenseColor: "charts.green",
  margin: "0 0 0 1.5em",
  cacheTtlHours: 168,
  requestTimeoutMs: 8000,
  maxConcurrentRequests: 8,
};
const ENTRY = { name: "lodash", spec: "^4", section: "dependencies", line: 0 };

test("formatAnnotation renders the template", () => {
  expect(formatAnnotation(BASE_CONFIG, ENTRY, { license: "MIT", source: "local" })).toBe("MIT");
  expect(
    formatAnnotation({ ...BASE_CONFIG, format: "${name} ${version} ${license}" }, ENTRY, {
      license: "MIT",
      version: "4.17.21",
      source: "local",
    })
  ).toBe("lodash 4.17.21 MIT");
  expect(
    formatAnnotation({ ...BASE_CONFIG, showResolvedVersion: true }, ENTRY, {
      license: "MIT",
      version: "4.17.21",
      source: "local",
    })
  ).toBe("MIT · 4.17.21");
});

// The inline annotation, not just the hover, should show engines.node when known (follow-up to #4).
test('formatAnnotation appends engines.node, like axios: "^1.1.1" // MIT (Node: >=20)', () => {
  expect(
    formatAnnotation(BASE_CONFIG, ENTRY, { license: "MIT", source: "registry", nodeEngine: ">=20" })
  ).toBe("MIT (Node: >=20)");
  // Nothing to append when the package doesn't declare one
  expect(formatAnnotation(BASE_CONFIG, ENTRY, { license: "MIT", source: "local" })).toBe("MIT");
  // The setting turns it off
  expect(
    formatAnnotation({ ...BASE_CONFIG, showNodeEngine: false }, ENTRY, {
      license: "MIT",
      source: "local",
      nodeEngine: ">=20",
    })
  ).toBe("MIT");
  // A custom template that already places ${nodeEngine} isn't appended to twice
  expect(
    formatAnnotation({ ...BASE_CONFIG, format: "${license} (node ${nodeEngine})" }, ENTRY, {
      license: "MIT",
      source: "local",
      nodeEngine: ">=20",
    })
  ).toBe("MIT (node >=20)");
});

test("formatAnnotation stays silent when there is nothing useful to say", () => {
  expect(formatAnnotation(BASE_CONFIG, ENTRY, { source: "unknown" })).toBeUndefined();
  // Skipped entries stay silent even when unknownText is set
  expect(
    formatAnnotation({ ...BASE_CONFIG, unknownText: "?" }, ENTRY, { source: "skipped" })
  ).toBeUndefined();
  expect(formatAnnotation({ ...BASE_CONFIG, unknownText: "?" }, ENTRY, { source: "unknown" })).toBe(
    "?"
  );
});

// The license is drawn in its own colour, so formatAnnotationSegments splits it out from whatever surrounds it in the template instead of returning one flat string.
test("formatAnnotationSegments splits the license out from the rest of the template", () => {
  // The default template is the license and nothing else
  expect(formatAnnotationSegments(BASE_CONFIG, ENTRY, { license: "MIT", source: "local" })).toEqual(
    { before: "", license: "MIT", after: "" }
  );

  // Literal text before/after ${license} stays in before/after, not license
  expect(
    formatAnnotationSegments({ ...BASE_CONFIG, format: "${name}: ${license} v${version}" }, ENTRY, {
      license: "MIT",
      version: "4.17.21",
      source: "local",
    })
  ).toEqual({ before: "lodash: ", license: "MIT", after: " v4.17.21" });

  // Appended version/nodeEngine text lands in `after`, alongside the license itself
  expect(
    formatAnnotationSegments(
      { ...BASE_CONFIG, showResolvedVersion: true, showNodeEngine: true },
      ENTRY,
      { license: "MIT", version: "4.17.21", source: "local", nodeEngine: ">=20" }
    )
  ).toEqual({ before: "", license: "MIT", after: " · 4.17.21 (Node: >=20)" });

  // A template without ${license} at all has nothing to colour — everything is `before`
  expect(
    formatAnnotationSegments({ ...BASE_CONFIG, format: "${name}" }, ENTRY, {
      license: "MIT",
      source: "local",
    })
  ).toEqual({ before: "lodash", license: "", after: "" });

  // A repeated ${license} still has to resolve to the actual value — only the first occurrence gets its own colour, but the second must not be left as literal, unresolved text.
  expect(
    formatAnnotationSegments({ ...BASE_CONFIG, format: "${license} / ${license}" }, ENTRY, {
      license: "MIT",
      source: "local",
    })
  ).toEqual({ before: "", license: "MIT", after: " / MIT" });

  // Concatenating the three segments must always equal what formatAnnotation itself returns
  const info: LicenseInfo = {
    license: "MIT",
    version: "4.17.21",
    source: "local",
    nodeEngine: ">=20",
  };
  const segments = formatAnnotationSegments(BASE_CONFIG, ENTRY, info);
  expect(`${segments!.before}${segments!.license}${segments!.after}`).toBe(
    formatAnnotation(BASE_CONFIG, ENTRY, info)
  );
});

// --- hover ---------------------------------------------------------------
// "name@1.2.3" is a syntactically valid GFM extended email autolink — numeric domain labels are allowed, so "4.17.21" parses as a domain — and VS Code's hover renderer (marked) turns it into a mailto: link unless it is wrapped in a code span. Verified against `marked` directly: rendering "lodash@4.17.21" produces `<a href="mailto:...">`, and wrapping it in backticks is what suppresses that.

test("buildHover wraps name@version in a code span so it cannot be linkified as an email", () => {
  const hover = buildHover(ENTRY, { license: "MIT", version: "4.17.21", source: "local" })!;
  expect(hover.value).toMatch(/`lodash@4\.17\.21`/);
  // Guard against a regression that keeps the backticks but still leaves the bare form nearby
  expect(hover.value.replace(/`lodash@4\.17\.21`/, "")).not.toMatch(/lodash@4\.17\.21/);
});

test("buildHover falls back to just the name when no version resolved", () => {
  const hover = buildHover(ENTRY, { source: "unknown", detail: "not found" })!;
  expect(hover.value).toMatch(/`lodash`/);
  expect(hover.value).not.toMatch(/@/);
});

test("buildHover still shows the lookup path on the Resolved from line when the source is unknown", () => {
  // A provider can know *how* it looked something up even when the lookup itself failed
  // (e.g. Cargo.lock pinned a version but the registry has no license for it) — that path
  // shouldn't be silently dropped just because resolution didn't succeed.
  const hover = buildHover(ENTRY, {
    source: "unknown",
    version: "1.0.0",
    via: "Cargo.lock + crates.io",
    detail: "no license field",
  })!;
  expect(hover.value).toMatch(/Resolved from: Cargo\.lock \+ crates\.io/);
  expect(hover.value).toMatch(/License: _unknown_ — no license field/);
});

test("buildHover links the title to npmjs.org when registryPackageName is set", () => {
  const hover = buildHover(ENTRY, {
    license: "MIT",
    version: "4.17.21",
    source: "local",
    registryPackageName: "lodash",
  })!;
  expect(hover.value).toMatch(
    /\*\*\[`lodash@4\.17\.21`\]\(https:\/\/www\.npmjs\.com\/package\/lodash\/v\/4\.17\.21\)\*\*/
  );
});

test("buildHover links to the alias target, not the local package.json key", () => {
  // "lodash4": "npm:lodash@^4.0.0" — the hover title still reads "lodash4@4.17.21" (the name the user actually wrote), but the link must point at the real npm package.
  const hover = buildHover(
    { name: "lodash4", spec: "npm:lodash@^4.0.0", section: "dependencies", line: 0 },
    { license: "MIT", version: "4.17.21", source: "registry", registryPackageName: "lodash" }
  )!;
  expect(hover.value).toMatch(/`lodash4@4\.17\.21`/);
  expect(hover.value).toMatch(/\]\(https:\/\/www\.npmjs\.com\/package\/lodash\/v\/4\.17\.21\)/);
});

test("buildHover links the title to jsr.io for JSR packages, never to npmjs.org", () => {
  // JSR packages are never published to npmjs.org under their JSR or npm-compatibility name, so registryPackageName is never set for them; JsrClient supplies packagePageUrl instead.
  const jsrUrl = "https://jsr.io/@std/fs@1.0.24";
  const hover = buildHover(
    { name: "@std/fs", spec: "jsr:@std/fs@^1.0.0", section: "dependencies", line: 0 },
    {
      license: "MIT",
      version: "1.0.24",
      source: "registry",
      via: "jsr.io",
      homepage: jsrUrl,
      packagePageUrl: jsrUrl,
    }
  )!;
  expect(hover.value).not.toMatch(/npmjs\.com/);
  expect(hover.value).toMatch(
    /\*\*\[`@std\/fs@1\.0\.24`\]\(https:\/\/jsr\.io\/@std\/fs@1\.0\.24\)\*\*/
  );
  // The title link and the Homepage line would otherwise point at the exact same URL, so the redundant Homepage line is dropped.
  expect((hover.value.match(/\[Homepage\]/g) ?? []).length).toBe(0);
});

test("buildHover still shows a separate Homepage line when it differs from the title link", () => {
  const hover = buildHover(ENTRY, {
    license: "MIT",
    version: "4.17.21",
    source: "local",
    registryPackageName: "lodash",
    homepage: "https://lodash.com/",
  })!;
  expect(hover.value).toMatch(/\[Homepage\]\(https:\/\/lodash\.com\/\)/);
});

test("buildHover leaves the title unlinked without a resolved version", () => {
  const hover = buildHover(ENTRY, {
    source: "unknown",
    detail: "no published version matches",
    registryPackageName: "lodash",
  })!;
  expect(hover.value).not.toMatch(/npmjs\.com/);
});

test("buildHover shows engines.node right after the license, when known", () => {
  const hover = buildHover(ENTRY, {
    license: "MIT",
    version: "4.17.21",
    source: "local",
    nodeEngine: ">=18.0.0",
  })!;
  expect(hover.value).toMatch(/License: `MIT`\n\nNode: `>=18\.0\.0`/);
});

test("buildHover omits the Node line when engines.node is unknown", () => {
  const hover = buildHover(ENTRY, { license: "MIT", version: "4.17.21", source: "local" })!;
  expect(hover.value).not.toMatch(/Node:/);
});

function memoryMemento() {
  const store: Record<string, unknown> = {};
  return {
    keys: () => Object.keys(store),
    get: <T>(key: string, fallback?: T) => (key in store ? (store[key] as T) : fallback),
    update: async (key: string, value: unknown) => {
      store[key] = value;
    },
  };
}
