// Load the vscode stub first, because the modules under test require it
const { fakeDocument, stub } = require("./vscode-stub");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const OUT = path.join(__dirname, "..", "..", "..", "out");
const { parseSpec, encodePackageName } = require(path.join(OUT, "providers/npm/spec.js"));
const { normalizeLicense, normalizeNodeEngine } = require(
  path.join(OUT, "providers/npm/manifest.js")
);
const { parsePackageJson } = require(path.join(OUT, "providers/npm/parse.js"));
const { parsePnpmWorkspaceYaml } = require(path.join(OUT, "providers/npm/pnpmWorkspace.js"));
const { parseDenoManifest, parseDenoSpecifier, isDenoManifest } = require(
  path.join(OUT, "providers/jsr/parse.js")
);
const { parseJsrPackageName, parseJsrNpmCompatName } = require(
  path.join(OUT, "providers/jsr/client.js")
);
const { formatAnnotation, formatAnnotationSegments, buildHover } = require(
  path.join(OUT, "format.js")
);
const lock = require(path.join(OUT, "providers/npm/lockfile/parsers.js"));
const { LicenseCache } = require(path.join(OUT, "cache.js"));
const { NpmLicenseProvider } = require(path.join(OUT, "providers/npm/index.js"));
const { vscodeProviderHost } = require(path.join(OUT, "vscodeFs.js"));

const noCancel = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
};
const memoryMemento = () => ({
  store: {},
  get(key) {
    return this.store[key];
  },
  async update(key, value) {
    this.store[key] = value;
  },
});

const FIXTURES = path.join(__dirname, "..", "..", "..", "test", "fixtures", "lockfiles");
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

// --- the shipped bundle -----------------------------------------------------
// The tests above load out/, which is plain tsc output. dist/extension.js is what actually ships, and bundling can break it on its own — a dependency whose entry point defers its require() calls to runtime resolves fine under tsc and then fails inside the extension host. So load the real bundle too.

test("the bundled extension loads and exposes its entry points", (t) => {
  const bundle = path.join(__dirname, "..", "..", "..", "dist", "extension.js");
  if (!fs.existsSync(bundle)) {
    t.skip("dist/extension.js is not built; run npm run compile");
    return;
  }
  delete require.cache[require.resolve(bundle)];
  const extension = require(bundle);
  assert.equal(typeof extension.activate, "function");
  assert.equal(typeof extension.deactivate, "function");
});

// --- version specifiers -----------------------------------------------------

test("parseSpec classifies npm version specifiers", () => {
  const kindOf = (spec) => parseSpec("pkg", spec).kind;

  assert.equal(kindOf("^4.17.21"), "range");
  assert.equal(kindOf("4.17.21"), "range");
  assert.equal(kindOf(">=1.0.0 <2.0.0"), "range");
  assert.equal(kindOf("1.x || 2.x"), "range");
  assert.equal(kindOf("*"), "tag");
  assert.equal(kindOf(""), "tag");
  assert.equal(kindOf("next"), "tag");

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
    assert.equal(kindOf(spec), "unresolvable", `${spec} should be unresolvable`);
  }
});

// pnpm workspace catalogs write the specifier verbatim into package.json — verified against a real `pnpm add` with a `catalog:` entry in pnpm-workspace.yaml.
test("parseSpec recognises pnpm workspace catalog references", () => {
  assert.deepEqual(
    { ...parseSpec("typescript", "catalog:") },
    { kind: "catalog", name: "typescript", spec: "catalog:" }
  );
  assert.deepEqual(
    { ...parseSpec("typescript", "catalog:build") },
    { kind: "catalog", name: "typescript", spec: "catalog:build" }
  );
});

test("parseSpec follows npm: aliases to their target", () => {
  assert.deepEqual(
    { ...parseSpec("lodash4", "npm:lodash@^4.0.0") },
    { kind: "range", name: "lodash", spec: "^4.0.0" }
  );
  assert.deepEqual(
    { ...parseSpec("x", "npm:@scope/pkg@1.2.3") },
    { kind: "range", name: "@scope/pkg", spec: "1.2.3" }
  );
  // No version means latest
  assert.equal(parseSpec("x", "npm:lodash").spec, "latest");
});

// pnpm >=10.9 and Yarn >=4.9 write these two shapes for JSR packages — verified by actually running `pnpm add jsr:@luca/cases` and `pnpm add cases-alias@jsr:@luca/cases`.
test("parseSpec recognises the jsr: specifier pnpm/Yarn write", () => {
  // bare form: the package.json key is itself the JSR name — "@luca/cases": "jsr:^1.0.0"
  assert.deepEqual(
    { ...parseSpec("@luca/cases", "jsr:^1.0.0") },
    { kind: "jsr", name: "@luca/cases", spec: "^1.0.0" }
  );
  // aliased form: the JSR name lives in the value — "cases-alias": "jsr:@luca/cases@^1.0.0"
  assert.deepEqual(
    { ...parseSpec("cases-alias", "jsr:@luca/cases@^1.0.0") },
    { kind: "jsr", name: "@luca/cases", spec: "^1.0.0" }
  );
  // No version means latest, for both forms
  assert.equal(parseSpec("@luca/cases", "jsr:").spec, "latest");
  assert.equal(parseSpec("x", "jsr:@luca/cases").spec, "latest");
});

test("resolve() skips a jsr: specifier whose name is not scoped, rather than sending it to npmjs.org", async () => {
  const provider = new NpmLicenseProvider(new LicenseCache(memoryMemento()), vscodeProviderHost);
  const document = fakeDocument("{}", "d:/project/package.json");
  const info = await provider.resolve(
    { name: "not-scoped", spec: "jsr:^1.0.0", section: "dependencies", line: 0 },
    document,
    noCancel
  );
  assert.equal(info.source, "skipped");
});

// A `catalog:` reference has no version of its own to send to npmjs.org — only pnpm-lock.yaml's importers section knows what it resolved to. Previously it was misclassified as `unresolvable` (alongside file:/workspace:/git) and silently skipped instead of ever being looked up there (issue #1).
test("resolve() reports a catalog: reference as unknown, not skipped, when no lockfile answers it", async () => {
  const provider = new NpmLicenseProvider(new LicenseCache(memoryMemento()), vscodeProviderHost);
  const document = fakeDocument("{}", "d:/project/package.json");
  const info = await provider.resolve(
    { name: "typescript", spec: "catalog:", section: "devDependencies", line: 0 },
    document,
    noCancel
  );
  assert.equal(info.source, "unknown");
  assert.match(info.detail, /catalog/);
});

// The hover title lost its npmjs.org link for a catalog: dependency that resolves straight from node_modules (issue #2). registryPackageName has to be set on this path too, not just the lockfile path, since a catalog reference names a real npm package just as much as a plain semver range does.
test("resolve() links a catalog: dependency resolved from node_modules to npmjs.org", async () => {
  const originalReadFile = stub.workspace.fs.readFile;
  stub.workspace.fs.readFile = async (uri) => {
    if (uri.path === "/d:/project/node_modules/@types/node/package.json") {
      return Buffer.from(
        JSON.stringify({ name: "@types/node", version: "22.20.1", license: "MIT" })
      );
    }
    throw new Error("not found");
  };
  try {
    const provider = new NpmLicenseProvider(new LicenseCache(memoryMemento()), vscodeProviderHost);
    const document = fakeDocument("{}", "d:/project/package.json");
    const info = await provider.resolve(
      { name: "@types/node", spec: "catalog:", section: "devDependencies", line: 0 },
      document,
      noCancel
    );
    assert.equal(info.license, "MIT");
    assert.equal(info.registryPackageName, "@types/node");
  } finally {
    stub.workspace.fs.readFile = originalReadFile;
  }
});

// issue #4: an installed package's engines.node should reach the hover.
test("resolve() surfaces engines.node from an installed package", async () => {
  const originalReadFile = stub.workspace.fs.readFile;
  stub.workspace.fs.readFile = async (uri) => {
    if (uri.path === "/d:/project/node_modules/typescript/package.json") {
      return Buffer.from(
        JSON.stringify({
          name: "typescript",
          version: "5.6.3",
          license: "Apache-2.0",
          engines: { node: ">=14.17" },
        })
      );
    }
    throw new Error("not found");
  };
  try {
    const provider = new NpmLicenseProvider(new LicenseCache(memoryMemento()), vscodeProviderHost);
    const document = fakeDocument("{}", "d:/project/package.json");
    const info = await provider.resolve(
      { name: "typescript", spec: "^5.0.0", section: "dependencies", line: 0 },
      document,
      noCancel
    );
    assert.equal(info.nodeEngine, ">=14.17");
  } finally {
    stub.workspace.fs.readFile = originalReadFile;
  }
});

test("encodePackageName encodes the scope separator", () => {
  assert.equal(encodePackageName("@babel/core"), "@babel%2fcore");
  assert.equal(encodePackageName("lodash"), "lodash");
});

// --- license field normalisation --------------------------------------------

test("normalizeLicense handles every historical shape", () => {
  assert.equal(normalizeLicense({ license: "MIT" }), "MIT");
  assert.equal(normalizeLicense({ license: { type: "ISC" } }), "ISC");
  assert.equal(normalizeLicense({ licenses: [{ type: "MIT" }] }), "MIT");
  assert.equal(
    normalizeLicense({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] }),
    "(MIT OR Apache-2.0)"
  );
  assert.equal(normalizeLicense({ license: "  " }), undefined);
  assert.equal(normalizeLicense({}), undefined);
  assert.equal(normalizeLicense(undefined), undefined);
});

// issue #4: engines.node should surface in the hover, right after the license.
test("normalizeNodeEngine reads engines.node", () => {
  assert.equal(normalizeNodeEngine({ engines: { node: ">=18.0.0" } }), ">=18.0.0");
  assert.equal(normalizeNodeEngine({ engines: { node: "  " } }), undefined);
  assert.equal(normalizeNodeEngine({ engines: {} }), undefined);
  assert.equal(normalizeNodeEngine({}), undefined);
  assert.equal(normalizeNodeEngine(undefined), undefined);
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
  assert.deepEqual(
    entries.map((e) => `${e.section}/${e.name}@${e.spec}#${e.line}`),
    [
      "dependencies/lodash@^4.17.21#3",
      "dependencies/@babel/core@7.24.0#4",
      "devDependencies/typescript@~5.7.0#7",
      "customDependencies/left-pad@1.3.0#13",
    ]
  );
});

test("parsePackageJson ignores non-string values such as peerDependenciesMeta", () => {
  const entries = parsePackageJson(fakeDocument(PACKAGE_JSON), ALL_SECTIONS);
  assert.equal(entries.filter((e) => e.section === "peerDependenciesMeta").length, 0);
});

test("parsePackageJson respects autoDetectSections", () => {
  const entries = parsePackageJson(fakeDocument(PACKAGE_JSON), {
    sections: ["dependencies"],
    autoDetectSections: false,
  });
  assert.deepEqual(
    entries.map((e) => e.name),
    ["lodash", "@babel/core"]
  );
});

test("parsePackageJson keeps working while the JSON is half-typed", () => {
  const entries = parsePackageJson(fakeDocument(`{ "dependencies": { "a": "^1.0.0", "b": `), {
    sections: ["dependencies"],
    autoDetectSections: false,
  });
  assert.deepEqual(
    entries.map((e) => e.name),
    ["a"]
  );
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
  const entries = parsePnpmWorkspaceYaml(fakeDocument(yaml, "d:/repo/pnpm-workspace.yaml"));
  assert.deepEqual(
    entries.map((e) => [e.name, e.spec, e.section]),
    [
      ["react", "^18.3.1", "catalog"],
      ["@types/node", "^22.0.0", "catalog"],
      ["typescript", "5.6.3", "catalog"],
    ]
  );
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
  const entries = parsePnpmWorkspaceYaml(fakeDocument(yaml, "d:/repo/pnpm-workspace.yaml"));
  assert.deepEqual(
    entries.map((e) => [e.name, e.spec, e.section]),
    [
      ["react", "^17.0.2", "catalogs.react17"],
      ["react-dom", "^17.0.2", "catalogs.react17"],
      ["typescript", "^5.4.0", "catalogs.build"],
    ]
  );
});

test("parsePnpmWorkspaceYaml ignores unrelated top-level sections", () => {
  const yaml = ["packages:", "  - 'apps/*'", "", "catalog:", "  lodash: ^4.17.21", ""].join("\n");
  const entries = parsePnpmWorkspaceYaml(fakeDocument(yaml, "d:/repo/pnpm-workspace.yaml"));
  assert.deepEqual(
    entries.map((e) => e.name),
    ["lodash"]
  );
});

test("NpmLicenseProvider.supports recognises pnpm-workspace.yaml, not other yaml files", () => {
  const provider = new NpmLicenseProvider(new LicenseCache(memoryMemento()), vscodeProviderHost);
  assert.equal(provider.supports(fakeDocument("catalog:\n", "d:/repo/pnpm-workspace.yaml")), true);
  assert.equal(provider.supports(fakeDocument("foo: bar\n", "d:/repo/other.yaml")), false);
});

// --- Deno / JSR -------------------------------------------------------------

test("isDenoManifest recognises the manifest file names", () => {
  for (const name of ["deno.json", "deno.jsonc", "jsr.json", "import_map.json"]) {
    assert.ok(isDenoManifest(stub.Uri.file(`d:/p/${name}`)), name);
  }
  assert.equal(isDenoManifest(stub.Uri.file("d:/p/package.json")), false);
});

test("parseDenoSpecifier splits jsr: and npm: specifiers", () => {
  assert.deepEqual(
    { ...parseDenoSpecifier("jsr:@std/fs@^1.0.0") },
    { kind: "jsr", name: "@std/fs", range: "^1.0.0" }
  );
  assert.deepEqual(
    { ...parseDenoSpecifier("jsr:@std/fs") },
    { kind: "jsr", name: "@std/fs", range: "latest" }
  );
  assert.deepEqual(
    { ...parseDenoSpecifier("npm:chalk@^5.3.0") },
    { kind: "npm", name: "chalk", range: "^5.3.0" }
  );
  assert.deepEqual(
    { ...parseDenoSpecifier("npm:@scope/pkg@1.0.0") },
    { kind: "npm", name: "@scope/pkg", range: "1.0.0" }
  );
  // With a trailing subpath
  assert.deepEqual(
    { ...parseDenoSpecifier("npm:chalk@^5/lib/index.js") },
    { kind: "npm", name: "chalk", range: "^5" }
  );

  // Out of scope
  assert.equal(parseDenoSpecifier("jsr:@std/fs/"), undefined);
  assert.equal(parseDenoSpecifier("https://deno.land/std@0.220.0/fs/mod.ts"), undefined);
  assert.equal(parseDenoSpecifier("node:fs"), undefined);
  assert.equal(parseDenoSpecifier("./mod.ts"), undefined);
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
  const entries = parseDenoManifest(fakeDocument(text, "d:/p/deno.json"));
  assert.deepEqual(
    entries.map((e) => e.name),
    ["@std/fs", "chalk"]
  );
  assert.equal(entries[0].spec, "jsr:@std/fs@^1.0.0");
  assert.equal(entries[0].line, 2);
});

test("parseDenoManifest also reads a bare import map", () => {
  const entries = parseDenoManifest(
    fakeDocument(`{ "@std/fs": "jsr:@std/fs@^1.0.0" }`, "d:/p/import_map.json")
  );
  assert.deepEqual(
    entries.map((e) => e.name),
    ["@std/fs"]
  );
});

test("JSR package names convert to and from the npm-compat form", () => {
  assert.deepEqual({ ...parseJsrPackageName("@std/fs") }, { scope: "std", name: "fs" });
  assert.equal(parseJsrPackageName("lodash"), undefined);
  assert.deepEqual({ ...parseJsrNpmCompatName("@jsr/std__fs") }, { scope: "std", name: "fs" });
  assert.equal(parseJsrNpmCompatName("@babel/core"), undefined);
});

// --- lockfiles --------------------------------------------------------------
// The fixtures were produced by really installing with each package manager, so every one of them contains lodash@4.18.1 and @babel/code-frame@7.29.7.

const REAL_LOCKFILES = [
  ["npm.package-lock.json", lock.parseNpmLock, "npm"],
  ["pnpm.pnpm-lock.yaml", lock.parsePnpmLock, "pnpm"],
  ["yarn-classic.yarn.lock", lock.parseYarnLock, "yarn"],
  ["yarn-berry.yarn.lock", lock.parseYarnLock, "yarn-berry"],
  ["bun.bun.lock", lock.parseBunLock, "bun"],
];

for (const [fixture, parse, expectedKind] of REAL_LOCKFILES) {
  test(`lockfile: ${fixture} resolves direct and transitive dependencies`, () => {
    const index = parse(readFixture(fixture));
    assert.equal(index.kind, expectedKind);

    assert.equal(lock.lookupInIndex(index, "lodash", "^4.17.21")?.version, "4.18.1");
    assert.equal(lock.lookupInIndex(index, "@babel/code-frame", "^7.24.0")?.version, "7.29.7");
    assert.equal(lock.lookupInIndex(index, "js-tokens", "^4.0.0")?.version, "4.0.0");
    assert.equal(lock.lookupInIndex(index, "not-in-there", "^1.0.0"), undefined);
  });
}

test("lockfile: package-lock.json carries the license itself", () => {
  const index = lock.parseNpmLock(readFixture("npm.package-lock.json"));
  assert.equal(lock.lookupInIndex(index, "lodash", "^4.17.21")?.license, "MIT");
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
  assert.equal(lock.lookupInIndex(index, "ansi-styles", "^3.0.0")?.version, "3.2.1");
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
  assert.equal(hit?.version, "1.3.0");
  assert.equal(hit?.license, "WTFPL");
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
  assert.equal(lock.lookupInIndex(index, "semver", "^5.0.0")?.version, "5.7.1");
  assert.equal(lock.lookupInIndex(index, "semver", "^7.0.0")?.version, "7.6.0");
});

test("lockfile: older pnpm key shapes still parse", () => {
  const v6 = lock.parsePnpmLock(
    `lockfileVersion: '6.0'\n\npackages:\n\n  /@babel/code-frame@7.24.0:\n    resolution: {integrity: sha512-x}\n`
  );
  assert.equal(lock.lookupInIndex(v6, "@babel/code-frame", "^7.0.0")?.version, "7.24.0");

  const v5 = lock.parsePnpmLock(
    `lockfileVersion: 5.4\n\npackages:\n\n  /lodash/4.17.21:\n    resolution: {integrity: sha512-x}\n`
  );
  assert.equal(lock.lookupInIndex(v5, "lodash", "^4.0.0")?.version, "4.17.21");

  const peers = lock.parsePnpmLock(
    `lockfileVersion: '9.0'\n\npackages:\n\n  '@vue/compiler@3.4.0(vue@3.4.0)':\n    resolution: {integrity: sha512-x}\n`
  );
  assert.equal(lock.lookupInIndex(peers, "@vue/compiler", "^3.0.0")?.version, "3.4.0");
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
  assert.equal(lock.lookupInIndex(index, "typescript", "catalog:")?.version, "5.6.3");
  assert.equal(lock.lookupInIndex(index, "vitest", "catalog:test")?.version, "2.1.5");
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
  assert.equal(lock.lookupInIndex(index, "typescript", "catalog:"), undefined);
});

test("lockfile: a yarn heading may list several specifiers", () => {
  const index = lock.parseYarnLock(
    `lodash@^4.0.0, lodash@^4.17.21:\n  version "4.17.21"\n  resolved "https://x"\n`
  );
  assert.equal(lock.lookupInIndex(index, "lodash", "^4.0.0")?.version, "4.17.21");
  assert.equal(lock.lookupInIndex(index, "lodash", "^4.17.21")?.version, "4.17.21");
});

test("lockfile: bun nests packages under a composite key", () => {
  const index = lock.parseBunLock(
    `{"packages":{"parent/lodash":["lodash@4.17.21","",{},"sha512-x"],}}`
  );
  assert.equal(lock.lookupInIndex(index, "lodash", "^4.0.0")?.version, "4.17.21");
});

// --- rendering --------------------------------------------------------------

const BASE_CONFIG = {
  format: "${license}",
  showResolvedVersion: false,
  showNodeEngine: true,
  unknownText: "",
};
const ENTRY = { name: "lodash", spec: "^4", section: "dependencies", line: 0 };

test("formatAnnotation renders the template", () => {
  assert.equal(formatAnnotation(BASE_CONFIG, ENTRY, { license: "MIT", source: "local" }), "MIT");
  assert.equal(
    formatAnnotation({ ...BASE_CONFIG, format: "${name} ${version} ${license}" }, ENTRY, {
      license: "MIT",
      version: "4.17.21",
      source: "local",
    }),
    "lodash 4.17.21 MIT"
  );
  assert.equal(
    formatAnnotation({ ...BASE_CONFIG, showResolvedVersion: true }, ENTRY, {
      license: "MIT",
      version: "4.17.21",
      source: "local",
    }),
    "MIT · 4.17.21"
  );
});

// The inline annotation, not just the hover, should show engines.node when known (follow-up to #4).
test('formatAnnotation appends engines.node, like axios: "^1.1.1" // MIT (Node: >=20)', () => {
  assert.equal(
    formatAnnotation(BASE_CONFIG, ENTRY, {
      license: "MIT",
      source: "registry",
      nodeEngine: ">=20",
    }),
    "MIT (Node: >=20)"
  );
  // Nothing to append when the package doesn't declare one
  assert.equal(formatAnnotation(BASE_CONFIG, ENTRY, { license: "MIT", source: "local" }), "MIT");
  // The setting turns it off
  assert.equal(
    formatAnnotation({ ...BASE_CONFIG, showNodeEngine: false }, ENTRY, {
      license: "MIT",
      source: "local",
      nodeEngine: ">=20",
    }),
    "MIT"
  );
  // A custom template that already places ${nodeEngine} isn't appended to twice
  assert.equal(
    formatAnnotation({ ...BASE_CONFIG, format: "${license} (node ${nodeEngine})" }, ENTRY, {
      license: "MIT",
      source: "local",
      nodeEngine: ">=20",
    }),
    "MIT (node >=20)"
  );
});

test("formatAnnotation stays silent when there is nothing useful to say", () => {
  assert.equal(formatAnnotation(BASE_CONFIG, ENTRY, { source: "unknown" }), undefined);
  // Skipped entries stay silent even when unknownText is set
  assert.equal(
    formatAnnotation({ ...BASE_CONFIG, unknownText: "?" }, ENTRY, { source: "skipped" }),
    undefined
  );
  assert.equal(
    formatAnnotation({ ...BASE_CONFIG, unknownText: "?" }, ENTRY, { source: "unknown" }),
    "?"
  );
});

// The license is drawn in its own colour, so formatAnnotationSegments splits it out from whatever surrounds it in the template instead of returning one flat string.
test("formatAnnotationSegments splits the license out from the rest of the template", () => {
  // The default template is the license and nothing else
  assert.deepEqual(
    formatAnnotationSegments(BASE_CONFIG, ENTRY, { license: "MIT", source: "local" }),
    { before: "", license: "MIT", after: "" }
  );

  // Literal text before/after ${license} stays in before/after, not license
  assert.deepEqual(
    formatAnnotationSegments({ ...BASE_CONFIG, format: "${name}: ${license} v${version}" }, ENTRY, {
      license: "MIT",
      version: "4.17.21",
      source: "local",
    }),
    { before: "lodash: ", license: "MIT", after: " v4.17.21" }
  );

  // Appended version/nodeEngine text lands in `after`, alongside the license itself
  assert.deepEqual(
    formatAnnotationSegments(
      { ...BASE_CONFIG, showResolvedVersion: true, showNodeEngine: true },
      ENTRY,
      { license: "MIT", version: "4.17.21", source: "local", nodeEngine: ">=20" }
    ),
    { before: "", license: "MIT", after: " · 4.17.21 (Node: >=20)" }
  );

  // A template without ${license} at all has nothing to colour — everything is `before`
  assert.deepEqual(
    formatAnnotationSegments({ ...BASE_CONFIG, format: "${name}" }, ENTRY, {
      license: "MIT",
      source: "local",
    }),
    { before: "lodash", license: "", after: "" }
  );

  // A repeated ${license} still has to resolve to the actual value — only the first occurrence gets its own colour, but the second must not be left as literal, unresolved text.
  assert.deepEqual(
    formatAnnotationSegments({ ...BASE_CONFIG, format: "${license} / ${license}" }, ENTRY, {
      license: "MIT",
      source: "local",
    }),
    { before: "", license: "MIT", after: " / MIT" }
  );

  // Concatenating the three segments must always equal what formatAnnotation itself returns
  const info = { license: "MIT", version: "4.17.21", source: "local", nodeEngine: ">=20" };
  const segments = formatAnnotationSegments(BASE_CONFIG, ENTRY, info);
  assert.equal(
    `${segments.before}${segments.license}${segments.after}`,
    formatAnnotation(BASE_CONFIG, ENTRY, info)
  );
});

// --- hover ---------------------------------------------------------------
// "name@1.2.3" is a syntactically valid GFM extended email autolink — numeric domain labels are allowed, so "4.17.21" parses as a domain — and VS Code's hover renderer (marked) turns it into a mailto: link unless it is wrapped in a code span. Verified against `marked` directly: rendering "lodash@4.17.21" produces `<a href="mailto:...">`, and wrapping it in backticks is what suppresses that.

test("buildHover wraps name@version in a code span so it cannot be linkified as an email", () => {
  const hover = buildHover(ENTRY, { license: "MIT", version: "4.17.21", source: "local" });
  assert.match(hover.value, /`lodash@4\.17\.21`/);
  // Guard against a regression that keeps the backticks but still leaves the bare form nearby
  assert.doesNotMatch(hover.value.replace(/`lodash@4\.17\.21`/, ""), /lodash@4\.17\.21/);
});

test("buildHover falls back to just the name when no version resolved", () => {
  const hover = buildHover(ENTRY, { source: "unknown", detail: "not found" });
  assert.match(hover.value, /`lodash`/);
  assert.doesNotMatch(hover.value, /@/);
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
  });
  assert.match(hover.value, /Resolved from: Cargo\.lock \+ crates\.io/);
  assert.match(hover.value, /License: _unknown_ — no license field/);
});

test("buildHover links the title to npmjs.org when registryPackageName is set", () => {
  const hover = buildHover(ENTRY, {
    license: "MIT",
    version: "4.17.21",
    source: "local",
    registryPackageName: "lodash",
  });
  assert.match(
    hover.value,
    /\*\*\[`lodash@4\.17\.21`\]\(https:\/\/www\.npmjs\.com\/package\/lodash\/v\/4\.17\.21\)\*\*/
  );
});

test("buildHover links to the alias target, not the local package.json key", () => {
  // "lodash4": "npm:lodash@^4.0.0" — the hover title still reads "lodash4@4.17.21" (the name the user actually wrote), but the link must point at the real npm package.
  const hover = buildHover(
    { name: "lodash4", spec: "npm:lodash@^4.0.0", section: "dependencies", line: 0 },
    { license: "MIT", version: "4.17.21", source: "registry", registryPackageName: "lodash" }
  );
  assert.match(hover.value, /`lodash4@4\.17\.21`/);
  assert.match(hover.value, /\]\(https:\/\/www\.npmjs\.com\/package\/lodash\/v\/4\.17\.21\)/);
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
  );
  assert.doesNotMatch(hover.value, /npmjs\.com/);
  assert.match(
    hover.value,
    /\*\*\[`@std\/fs@1\.0\.24`\]\(https:\/\/jsr\.io\/@std\/fs@1\.0\.24\)\*\*/
  );
  // The title link and the Homepage line would otherwise point at the exact same URL, so the redundant Homepage line is dropped.
  assert.equal((hover.value.match(/\[Homepage\]/g) ?? []).length, 0);
});

test("buildHover still shows a separate Homepage line when it differs from the title link", () => {
  const hover = buildHover(ENTRY, {
    license: "MIT",
    version: "4.17.21",
    source: "local",
    registryPackageName: "lodash",
    homepage: "https://lodash.com/",
  });
  assert.match(hover.value, /\[Homepage\]\(https:\/\/lodash\.com\/\)/);
});

test("buildHover leaves the title unlinked without a resolved version", () => {
  const hover = buildHover(ENTRY, {
    source: "unknown",
    detail: "no published version matches",
    registryPackageName: "lodash",
  });
  assert.doesNotMatch(hover.value, /npmjs\.com/);
});

test("buildHover shows engines.node right after the license, when known", () => {
  const hover = buildHover(ENTRY, {
    license: "MIT",
    version: "4.17.21",
    source: "local",
    nodeEngine: ">=18.0.0",
  });
  assert.match(hover.value, /License: `MIT`\n\nNode: `>=18\.0\.0`/);
});

test("buildHover omits the Node line when engines.node is unknown", () => {
  const hover = buildHover(ENTRY, { license: "MIT", version: "4.17.21", source: "local" });
  assert.doesNotMatch(hover.value, /Node:/);
});
