const { fakeDocument, stub } = require("./vscode-stub");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");

const CORE_OUT = path.join(__dirname, "..", "..", "packages", "core", "out");
const EXT_OUT = path.join(__dirname, "..", "..", "packages", "vscode-extension", "out", "src");
const { tokenize, readImportItems, readStringAssignment, readStringArrayAssignment } = require(
  path.join(CORE_OUT, "providers/moonbit/dsl")
);
const { parseManifest, manifestFormat } = require(path.join(CORE_OUT, "providers/moonbit/parse"));
const { parseIndex } = require(path.join(CORE_OUT, "providers/moonbit/registryIndex"));
const { isModuleName, isModuleVersion, isRegistryModuleName } = require(
  path.join(CORE_OUT, "providers/moonbit/spec")
);
const { MoonbitLicenseProvider } = require(path.join(CORE_OUT, "providers/moonbit"));
const { LicenseCache } = require(path.join(CORE_OUT, "cache"));
const { buildHover } = require(path.join(CORE_OUT, "format"));
const { vscodeProviderHost } = require(path.join(EXT_OUT, "vscodeFs"));

const noCancel = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
};
const makeCache = () => new LicenseCache({ get() {}, async update() {} });

// --- the moon.mod DSL -------------------------------------------------------

test("the DSL reader sees through comments, escapes and nesting", () => {
  const text = [
    '// import { "commented/out@1.0.0" }',
    'name = "plv/demo"',
    'license = "MIT"',
    'rule(name: "gen", options: { deps: ["not/a@1.0.0"] })',
    "import {",
    '  "moonbitlang/x@0.4.10", // trailing comment',
    '  "moonbitlang/async@0.21.3",',
    "}",
    'members = ["./a", "./b"]',
  ].join("\n");
  const tokens = tokenize(text);

  assert.equal(readStringAssignment(tokens, "name"), "plv/demo");
  assert.equal(readStringAssignment(tokens, "license"), "MIT");
  assert.equal(readStringAssignment(tokens, "missing"), undefined);
  assert.deepEqual(readStringArrayAssignment(tokens, "members"), ["./a", "./b"]);
  assert.deepEqual(
    readImportItems(tokens).map((item) => item.value),
    ["moonbitlang/x@0.4.10", "moonbitlang/async@0.21.3"]
  );

  // A string inside an apply() argument list is not an import item
  assert.equal(
    readImportItems(tokenize('rule(deps: { import: { "nope/nope@1.0.0" } })')).length,
    0
  );
  // An escaped quote must not end the string early
  assert.equal(readStringAssignment(tokenize('name = "a\\"b"'), "name"), 'a"b');
  // An unterminated string ends the scan instead of throwing
  assert.deepEqual(tokenize('name = "oops').slice(-1)[0].value, "=");
});

test("moon.mod dependencies split on the last @, like moon does", () => {
  const text = [
    'name = "plv/demo"',
    "import {",
    '  "moonbitlang/x@0.4.10",',
    '  "tonyfettes/tree-sitter/cli@0.1.0",',
    '  "broken/nover",',
    '  "@leading/at",',
    "}",
  ].join("\n");
  const manifest = parseManifest(text, "file:///p/moon.mod", "dsl");

  assert.equal(manifest.moduleName, "plv/demo");
  assert.deepEqual(
    manifest.entries.map((entry) => [entry.name, entry.declaration, entry.section, entry.line]),
    [
      ["moonbitlang/x", { kind: "registry", version: "0.4.10" }, "import", 2],
      ["tonyfettes/tree-sitter/cli", { kind: "registry", version: "0.1.0" }, "import", 3],
      [
        "broken/nover",
        { kind: "unknown", reason: "`import` only accepts `module@version` in moon.mod" },
        "import",
        4,
      ],
      // `@leading/at` has its @ at index 0, so there is no name half at all
      [
        "@leading/at",
        { kind: "unknown", reason: "`import` only accepts `module@version` in moon.mod" },
        "import",
        5,
      ],
    ]
  );
});

// --- moon.mod.json ----------------------------------------------------------

test("moon.mod.json reads deps and bin-deps in every declared form", () => {
  const text = [
    "{",
    '  "name": "plv/demo",',
    '  "deps": {',
    '    "moonbitlang/x": "0.4.10",',
    '    "plv/pinned": { "version": "1.2.3" },',
    '    "plv/local": { "path": "../local" },',
    '    "plv/fromgit": { "git": "https://example.com/m.git", "branch": "main" },',
    '    "plv/newest": {},',
    '    "plv/empty": "",',
    '    "plv/bogus": 7',
    "  },",
    '  "bin-deps": { "plv/tool": "0.1.0" }',
    "}",
  ].join("\n");
  const manifest = parseManifest(text, "file:///p/moon.mod.json", "json");

  assert.equal(manifest.moduleName, "plv/demo");
  assert.deepEqual(
    manifest.entries.map((entry) => [entry.name, entry.section, entry.declaration]),
    [
      ["moonbitlang/x", "deps", { kind: "registry", version: "0.4.10" }],
      ["plv/pinned", "deps", { kind: "registry", version: "1.2.3" }],
      ["plv/local", "deps", { kind: "skipped", reason: "local path dependency" }],
      ["plv/fromgit", "deps", { kind: "skipped", reason: "git dependency" }],
      ["plv/newest", "deps", { kind: "registry" }],
      ["plv/empty", "deps", { kind: "unknown", reason: "empty version" }],
      ["plv/bogus", "deps", { kind: "unknown", reason: "invalid dependency declaration" }],
      ["plv/tool", "bin-deps", { kind: "registry", version: "0.1.0" }],
    ]
  );
  assert.deepEqual(
    manifest.entries.map((entry) => entry.line),
    [3, 4, 5, 6, 7, 8, 9, 11]
  );
  // A half-typed manifest still yields whatever can already be read
  assert.equal(
    parseManifest('{"deps":{"a/b":"1.0.0",', "file:///p/moon.mod.json", "json").entries.length,
    1
  );
  assert.deepEqual(parseManifest("[]", "file:///p/moon.mod.json", "json").entries, []);
});

test("only the two module manifest file names are recognized", () => {
  assert.equal(manifestFormat("/p/moon.mod"), "dsl");
  assert.equal(manifestFormat("/p/moon.mod.json"), "json");
  assert.equal(manifestFormat("/p/moon.pkg"), undefined);
  assert.equal(manifestFormat("/p/moon.pkg.json"), undefined);
  assert.equal(manifestFormat("/p/moon.work"), undefined);
});

// --- names, versions and the registry index ---------------------------------

test("module names and versions are validated the way moon parses them", () => {
  assert.ok(isModuleName("moonbitlang/x"));
  assert.ok(isModuleName("tonyfettes/tree-sitter/cli"));
  assert.ok(!isModuleName("noslash"));
  assert.ok(!isModuleName("bad/name!"));
  // mooncakes.io only answers for user/module, even though the index nests deeper
  assert.ok(isRegistryModuleName("moonbitlang/x"));
  assert.ok(!isRegistryModuleName("moonbitlang/lex/runtime"));

  assert.ok(isModuleVersion("0.4.10"));
  assert.ok(isModuleVersion("1.0.0-beta.1+build.5"));
  // A version is an exact release, never a range
  assert.ok(!isModuleVersion("^0.4.10"));
  assert.ok(!isModuleVersion("v1.0.0"));
  assert.ok(!isModuleVersion("0.4"));
});

test("the registry index drops bad lines instead of the whole file", () => {
  const text = [
    '{"name":"moonbitlang/x","version":"0.4.10","license":"Apache-2.0","repository":"https://github.com/moonbitlang/x"}',
    "not json",
    '{"name":"someone/else","version":"9.9.9","license":"MIT"}',
    '{"name":"moonbitlang/x","version":"not-a-version"}',
    '{"name":"moonbitlang/x","version":"0.5.0","license":"   "}',
    "",
  ].join("\n");
  assert.deepEqual(parseIndex(text, "moonbitlang/x"), [
    {
      version: "0.4.10",
      license: "Apache-2.0",
      repository: "https://github.com/moonbitlang/x",
    },
    { version: "0.5.0", license: undefined, repository: undefined },
  ]);
});

// --- the provider -----------------------------------------------------------

/** Serve a fake filesystem and record every mooncakes.io request */
function mount(t, files) {
  t.mock.method(stub.workspace.fs, "readFile", async (uri) => {
    if (!files.has(uri.path)) throw Object.assign(new Error("missing"), { code: "FileNotFound" });
    return Buffer.from(files.get(uri.path));
  });
  const calls = [];
  t.mock.method(global, "fetch", async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        module: "plv/remote",
        version: "2.0.0",
        yanked: false,
        metadata: {
          name: "plv/remote",
          version: "2.0.0",
          license: "MIT",
          repository: "https://example.com/remote",
        },
      }),
    };
  });
  return calls;
}

const INDEX = "/moon-home/registry/index/user";

test("MoonBit resolution prefers .mooncakes, then moon.work, then the index, then mooncakes.io", async (t) => {
  process.env.MOON_HOME = "/moon-home";
  t.after(() => delete process.env.MOON_HOME);

  const files = new Map([
    [
      "/repo/member/.mooncakes/plv/unpacked/moon.mod.json",
      '{"name":"plv/unpacked","version":"0.9.1","license":"Apache-2.0","repository":"https://example.com/u"}',
    ],
    // A workspace whose own member is declared as a dependency
    ["/repo/moon.work", 'members = ["./member", "./other"]'],
    ["/repo/other/moon.mod", 'name = "plv/other"\nversion = "0.2.0"\nlicense = "MIT"'],
    [
      `${INDEX}/plv/indexed.index`,
      '{"name":"plv/indexed","version":"1.0.0","license":"BSD-3-Clause"}\n' +
        '{"name":"plv/indexed","version":"1.1.0","license":"MIT"}\n',
    ],
  ]);
  const calls = mount(t, files);
  const cache = makeCache();
  t.after(() => cache.dispose());
  const provider = new MoonbitLicenseProvider(cache, vscodeProviderHost);

  const document = fakeDocument(
    [
      "import {",
      '  "plv/unpacked@0.5.0",',
      '  "plv/other@0.1.0",',
      '  "plv/indexed@1.0.0",',
      '  "plv/remote@2.0.0",',
      "}",
    ].join("\n"),
    "/repo/member/moon.mod"
  );
  const entries = provider.parse(document);
  const resolved = [];
  for (const entry of entries) resolved.push(await provider.resolve(entry, document, noCancel));

  // 1. what moon actually unpacked wins over the floor written in the manifest
  assert.deepEqual(
    { ...resolved[0] },
    {
      source: "local",
      license: "Apache-2.0",
      version: "0.9.1",
      homepage: "https://example.com/u",
      packagePageUrl: "https://mooncakes.io/docs/plv/unpacked@0.9.1",
      via: "unpacked module (`.mooncakes`)",
      detail: undefined,
    }
  );
  // 2. a moon.work member is built from the repository, so nothing is looked up
  assert.deepEqual(resolved[1], {
    source: "skipped",
    detail: "built from a `moon.work` member",
  });
  // 3. the index answers for the exact declared version, not the newest one
  assert.equal(resolved[2].license, "BSD-3-Clause");
  assert.equal(resolved[2].version, "1.0.0");
  assert.equal(resolved[2].via, "local registry index (`moon update`)");
  assert.equal(resolved[2].packagePageUrl, "https://mooncakes.io/docs/plv/indexed@1.0.0");
  // 4. only the module nothing on disk knew about reached the network
  assert.deepEqual(calls, ["https://mooncakes.io/api/v0/modules/plv/remote@2.0.0"]);
  assert.equal(resolved[3].license, "MIT");
  assert.equal(resolved[3].source, "registry");
  assert.equal(resolved[3].via, "mooncakes.io");

  const hover = buildHover(entries[3], resolved[3]).value;
  assert.match(
    hover,
    /\[`plv\/remote@2\.0\.0`\]\(https:\/\/mooncakes\.io\/docs\/plv\/remote@2\.0\.0\)/
  );
});

test("what is on disk answers before the declared version is judged", async (t) => {
  const files = new Map([
    ["/repo/moon.work", 'members = ["./member", "./other"]'],
    ["/repo/other/moon.mod", 'name = "plv/other"\nversion = "0.2.0"\nlicense = "MIT"'],
    [
      "/repo/member/.mooncakes/plv/unpacked/moon.mod.json",
      '{"name":"plv/unpacked","version":"0.9.1","license":"Apache-2.0"}',
    ],
  ]);
  const calls = mount(t, files);
  const cache = makeCache();
  t.after(() => cache.dispose());
  const provider = new MoonbitLicenseProvider(cache, vscodeProviderHost);

  const document = fakeDocument(
    [
      "{",
      '  "deps": {',
      '    "plv/unpacked": "^0.5.0",',
      '    "plv/other": "workspace",',
      '    "plv/remote": "^2.0.0"',
      "  }",
      "}",
    ].join("\n"),
    "/repo/member/moon.mod.json"
  );
  const infos = [];
  for (const entry of provider.parse(document)) {
    infos.push(await provider.resolve(entry, document, noCancel));
  }

  assert.deepEqual(
    infos.map((info) => [info.source, info.license ?? info.detail]),
    [
      // What moon unpacked, and a member moon builds from the repository, both stand
      // whatever the manifest wrote next to them
      ["local", "Apache-2.0"],
      ["skipped", "built from a `moon.work` member"],
      // Only the module nothing on disk knew about is judged on its declaration
      ["unknown", "invalid version"],
    ]
  );
  assert.deepEqual(calls, []);
});

test("declarations that mooncakes.io cannot answer for never reach it", async (t) => {
  const calls = mount(t, new Map());
  const cache = makeCache();
  t.after(() => cache.dispose());
  const provider = new MoonbitLicenseProvider(cache, vscodeProviderHost);

  const document = fakeDocument(
    [
      "{",
      '  "deps": {',
      '    "plv/local": { "path": "../local" },',
      '    "plv/fromgit": { "git": "https://example.com/m.git" },',
      '    "noslash": "1.0.0",',
      '    "plv/bad": "^1.0.0",',
      '    "moonbitlang/lex/runtime": "0.1.0"',
      "  }",
      "}",
    ].join("\n"),
    "/repo/moon.mod.json"
  );
  const infos = [];
  for (const entry of provider.parse(document)) {
    infos.push(await provider.resolve(entry, document, noCancel));
  }

  assert.deepEqual(
    infos.map((info) => [info.source, info.detail]),
    [
      ["skipped", "local path dependency"],
      ["skipped", "git dependency"],
      ["unknown", "invalid module name"],
      ["unknown", "invalid version"],
      // Nested names exist in the index but the API has no route for them
      ["unknown", "mooncakes.io only publishes `user/module` names"],
    ]
  );
  assert.deepEqual(calls, []);
});

test("a nested module name is never linked, since mooncakes.io has no page for one", async (t) => {
  process.env.MOON_HOME = "/moon-home";
  t.after(() => delete process.env.MOON_HOME);
  const calls = mount(
    t,
    new Map([
      [
        `${INDEX}/moonbitlang/lex/runtime.index`,
        '{"name":"moonbitlang/lex/runtime","version":"0.1.0","license":"Apache-2.0"}\n',
      ],
    ])
  );
  const cache = makeCache();
  t.after(() => cache.dispose());
  const provider = new MoonbitLicenseProvider(cache, vscodeProviderHost);
  const document = fakeDocument(
    'import {\n  "moonbitlang/lex/runtime@0.1.0",\n}',
    "/repo/moon.mod"
  );
  const [entry] = provider.parse(document);
  const info = await provider.resolve(entry, document, noCancel);

  assert.equal(info.license, "Apache-2.0");
  assert.equal(info.packagePageUrl, undefined);
  assert.deepEqual(calls, []);
  assert.match(buildHover(entry, info).value, /^\*\*`moonbitlang\/lex\/runtime@0\.1\.0`\*\*/);
});

test("a manifest inside .mooncakes is not a project manifest, and cache keys stay per declaration", () => {
  const cache = makeCache();
  const provider = new MoonbitLicenseProvider(cache, vscodeProviderHost);
  cache.dispose();

  assert.ok(provider.supports(fakeDocument("", "/repo/moon.mod")));
  assert.ok(provider.supports(fakeDocument("", "/repo/moon.mod.json")));
  assert.ok(!provider.supports(fakeDocument("", "/repo/.mooncakes/plv/x/moon.mod.json")));
  assert.ok(!provider.supports(fakeDocument("", "/repo/moon.pkg")));

  const of = (text, path) => provider.cacheKey(provider.parse(fakeDocument(text, path))[0]);
  const a = of('import {\n  "plv/x@1.0.0",\n}', "/a/moon.mod");
  assert.notEqual(a, of('import {\n  "plv/x@1.0.0",\n}', "/b/moon.mod"));
  assert.notEqual(a, of('import {\n  "plv/x@1.0.1",\n}', "/a/moon.mod"));
  assert.equal(a, of('import {\n  "plv/x@1.0.0", // same\n}', "/a/moon.mod"));
});
