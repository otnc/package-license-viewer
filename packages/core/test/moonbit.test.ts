import { afterEach, expect, test } from "vitest";
import { LicenseCache } from "../src/cache";
import { buildHover } from "../src/format";
import {
  readImportItems,
  readStringArrayAssignment,
  readStringAssignment,
  tokenize,
} from "../src/providers/moonbit/dsl";
import { MoonbitLicenseProvider } from "../src/providers/moonbit";
import { manifestFormat, parseManifest } from "../src/providers/moonbit/parse";
import { parseIndex } from "../src/providers/moonbit/registryIndex";
import { isModuleName, isModuleVersion, isRegistryModuleName } from "../src/providers/moonbit/spec";
import { fakeDocument, fakeHost } from "./support/fakeHost";

const noCancel = {
  isCancellationRequested: false,
  onCancellationRequested: (_listener: (e: unknown) => unknown) => ({ dispose() {} }),
};
const makeCache = () => new LicenseCache({ get() {}, keys: () => [], async update() {} });

afterEach(() => {
  delete process.env.MOON_HOME;
});

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

  expect(readStringAssignment(tokens, "name")).toBe("plv/demo");
  expect(readStringAssignment(tokens, "license")).toBe("MIT");
  expect(readStringAssignment(tokens, "missing")).toBeUndefined();
  expect(readStringArrayAssignment(tokens, "members")).toEqual(["./a", "./b"]);
  expect(readImportItems(tokens).map((item) => item.value)).toEqual([
    "moonbitlang/x@0.4.10",
    "moonbitlang/async@0.21.3",
  ]);

  // A string inside an apply() argument list is not an import item
  expect(readImportItems(tokenize('rule(deps: { import: { "nope/nope@1.0.0" } })'))).toHaveLength(
    0
  );
  // An escaped quote must not end the string early
  expect(readStringAssignment(tokenize('name = "a\\"b"'), "name")).toBe('a"b');
  // An unterminated string ends the scan instead of throwing
  expect(tokenize('name = "oops').slice(-1)[0].value).toBe("=");
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

  expect(manifest.moduleName).toBe("plv/demo");
  expect(
    manifest.entries.map((entry) => [entry.name, entry.declaration, entry.section, entry.line])
  ).toEqual([
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
  ]);
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

  expect(manifest.moduleName).toBe("plv/demo");
  expect(manifest.entries.map((entry) => [entry.name, entry.section, entry.declaration])).toEqual([
    ["moonbitlang/x", "deps", { kind: "registry", version: "0.4.10" }],
    ["plv/pinned", "deps", { kind: "registry", version: "1.2.3" }],
    ["plv/local", "deps", { kind: "skipped", reason: "local path dependency" }],
    ["plv/fromgit", "deps", { kind: "skipped", reason: "git dependency" }],
    ["plv/newest", "deps", { kind: "registry" }],
    ["plv/empty", "deps", { kind: "unknown", reason: "empty version" }],
    ["plv/bogus", "deps", { kind: "unknown", reason: "invalid dependency declaration" }],
    ["plv/tool", "bin-deps", { kind: "registry", version: "0.1.0" }],
  ]);
  expect(manifest.entries.map((entry) => entry.line)).toEqual([3, 4, 5, 6, 7, 8, 9, 11]);
  // A half-typed manifest still yields whatever can already be read
  expect(
    parseManifest('{"deps":{"a/b":"1.0.0",', "file:///p/moon.mod.json", "json").entries
  ).toHaveLength(1);
  expect(parseManifest("[]", "file:///p/moon.mod.json", "json").entries).toEqual([]);
});

test("only the two module manifest file names are recognized", () => {
  expect(manifestFormat("/p/moon.mod")).toBe("dsl");
  expect(manifestFormat("/p/moon.mod.json")).toBe("json");
  expect(manifestFormat("/p/moon.pkg")).toBeUndefined();
  expect(manifestFormat("/p/moon.pkg.json")).toBeUndefined();
  expect(manifestFormat("/p/moon.work")).toBeUndefined();
});

// --- names, versions and the registry index ---------------------------------

test("module names and versions are validated the way moon parses them", () => {
  expect(isModuleName("moonbitlang/x")).toBe(true);
  expect(isModuleName("tonyfettes/tree-sitter/cli")).toBe(true);
  expect(isModuleName("noslash")).toBe(false);
  expect(isModuleName("bad/name!")).toBe(false);
  // mooncakes.io only answers for user/module, even though the index nests deeper
  expect(isRegistryModuleName("moonbitlang/x")).toBe(true);
  expect(isRegistryModuleName("moonbitlang/lex/runtime")).toBe(false);

  expect(isModuleVersion("0.4.10")).toBe(true);
  expect(isModuleVersion("1.0.0-beta.1+build.5")).toBe(true);
  // A version is an exact release, never a range
  expect(isModuleVersion("^0.4.10")).toBe(false);
  expect(isModuleVersion("v1.0.0")).toBe(false);
  expect(isModuleVersion("0.4")).toBe(false);
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
  expect(parseIndex(text, "moonbitlang/x")).toEqual([
    { version: "0.4.10", license: "Apache-2.0", repository: "https://github.com/moonbitlang/x" },
    { version: "0.5.0", license: undefined, repository: undefined },
  ]);
});

// --- the provider -----------------------------------------------------------

/** A fake filesystem plus a recorder of every mooncakes.io request. */
function mount(files: Map<string, string>) {
  const host = fakeHost(files);
  const calls: string[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: string) => {
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
  }) as typeof fetch;
  return { host, calls, restore: () => (global.fetch = originalFetch) };
}

const INDEX = "/moon-home/registry/index/user";

test("MoonBit resolution prefers .mooncakes, then moon.work, then the index, then mooncakes.io", async () => {
  process.env.MOON_HOME = "/moon-home";

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
  const { host, calls, restore } = mount(files);
  const cache = makeCache();
  const provider = new MoonbitLicenseProvider(cache, host);

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
  expect({ ...resolved[0] }).toEqual({
    source: "local",
    license: "Apache-2.0",
    version: "0.9.1",
    homepage: "https://example.com/u",
    packagePageUrl: "https://mooncakes.io/docs/plv/unpacked@0.9.1",
    via: "unpacked module (`.mooncakes`)",
    detail: undefined,
  });
  // 2. a moon.work member is built from the repository, so nothing is looked up
  expect(resolved[1]).toEqual({ source: "skipped", detail: "built from a `moon.work` member" });
  // 3. the index answers for the exact declared version, not the newest one
  expect(resolved[2].license).toBe("BSD-3-Clause");
  expect(resolved[2].version).toBe("1.0.0");
  expect(resolved[2].via).toBe("local registry index (`moon update`)");
  expect(resolved[2].packagePageUrl).toBe("https://mooncakes.io/docs/plv/indexed@1.0.0");
  // 4. only the module nothing on disk knew about reached the network
  expect(calls).toEqual(["https://mooncakes.io/api/v0/modules/plv/remote@2.0.0"]);
  expect(resolved[3].license).toBe("MIT");
  expect(resolved[3].source).toBe("registry");
  expect(resolved[3].via).toBe("mooncakes.io");

  const hover = buildHover(entries[3], resolved[3])!.value;
  expect(hover).toMatch(
    /\[`plv\/remote@2\.0\.0`\]\(https:\/\/mooncakes\.io\/docs\/plv\/remote@2\.0\.0\)/
  );
  restore();
  cache.dispose();
});

test("what is on disk answers before the declared version is judged", async () => {
  const files = new Map([
    ["/repo/moon.work", 'members = ["./member", "./other"]'],
    ["/repo/other/moon.mod", 'name = "plv/other"\nversion = "0.2.0"\nlicense = "MIT"'],
    [
      "/repo/member/.mooncakes/plv/unpacked/moon.mod.json",
      '{"name":"plv/unpacked","version":"0.9.1","license":"Apache-2.0"}',
    ],
  ]);
  const { host, calls, restore } = mount(files);
  const cache = makeCache();
  const provider = new MoonbitLicenseProvider(cache, host);

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

  expect(infos.map((info) => [info.source, info.license ?? info.detail])).toEqual([
    // What moon unpacked, and a member moon builds from the repository, both stand
    // whatever the manifest wrote next to them
    ["local", "Apache-2.0"],
    ["skipped", "built from a `moon.work` member"],
    // Only the module nothing on disk knew about is judged on its declaration
    ["unknown", "invalid version"],
  ]);
  expect(calls).toEqual([]);
  restore();
  cache.dispose();
});

test("declarations that mooncakes.io cannot answer for never reach it", async () => {
  const { host, calls, restore } = mount(new Map());
  const cache = makeCache();
  const provider = new MoonbitLicenseProvider(cache, host);

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

  expect(infos.map((info) => [info.source, info.detail])).toEqual([
    ["skipped", "local path dependency"],
    ["skipped", "git dependency"],
    ["unknown", "invalid module name"],
    ["unknown", "invalid version"],
    // Nested names exist in the index but the API has no route for them
    ["unknown", "mooncakes.io only publishes `user/module` names"],
  ]);
  expect(calls).toEqual([]);
  restore();
  cache.dispose();
});

test("a nested module name is never linked, since mooncakes.io has no page for one", async () => {
  process.env.MOON_HOME = "/moon-home";
  const { host, calls, restore } = mount(
    new Map([
      [
        `${INDEX}/moonbitlang/lex/runtime.index`,
        '{"name":"moonbitlang/lex/runtime","version":"0.1.0","license":"Apache-2.0"}\n',
      ],
    ])
  );
  const cache = makeCache();
  const provider = new MoonbitLicenseProvider(cache, host);
  const document = fakeDocument(
    'import {\n  "moonbitlang/lex/runtime@0.1.0",\n}',
    "/repo/moon.mod"
  );
  const [entry] = provider.parse(document);
  const info = await provider.resolve(entry, document, noCancel);

  expect(info.license).toBe("Apache-2.0");
  expect(info.packagePageUrl).toBeUndefined();
  expect(calls).toEqual([]);
  expect(buildHover(entry, info)!.value).toMatch(/^\*\*`moonbitlang\/lex\/runtime@0\.1\.0`\*\*/);
  restore();
  cache.dispose();
});

test("a manifest inside .mooncakes is not a project manifest, and cache keys stay per declaration", () => {
  const cache = makeCache();
  const provider = new MoonbitLicenseProvider(cache, fakeHost());
  cache.dispose();

  expect(provider.supports(fakeDocument("", "/repo/moon.mod"))).toBe(true);
  expect(provider.supports(fakeDocument("", "/repo/moon.mod.json"))).toBe(true);
  expect(provider.supports(fakeDocument("", "/repo/.mooncakes/plv/x/moon.mod.json"))).toBe(false);
  expect(provider.supports(fakeDocument("", "/repo/moon.pkg"))).toBe(false);

  const of = (text: string, path: string) =>
    provider.cacheKey(provider.parse(fakeDocument(text, path))[0]);
  const a = of('import {\n  "plv/x@1.0.0",\n}', "/a/moon.mod");
  expect(a).not.toBe(of('import {\n  "plv/x@1.0.0",\n}', "/b/moon.mod"));
  expect(a).not.toBe(of('import {\n  "plv/x@1.0.1",\n}', "/a/moon.mod"));
  expect(a).toBe(of('import {\n  "plv/x@1.0.0", // same\n}', "/a/moon.mod"));
});
