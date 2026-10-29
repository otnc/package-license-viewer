import { afterEach, expect, test } from "vitest";
import { LicenseCache } from "../src/cache";
import { buildHover } from "../src/format";
import { GoLicenseProvider } from "../src/providers/go";
import { combineLicenses } from "../src/providers/go/client";
import { matchPrefixPatterns, parseEnvFile } from "../src/providers/go/env";
import { parseGoMod, tokenizeLine } from "../src/providers/go/parse";
import { isDirectoryPath, isModulePath, isModuleVersion } from "../src/providers/go/spec";
import { fakeDocument, fakeHost } from "./support/fakeHost";

const noCancel = {
  isCancellationRequested: false,
  onCancellationRequested: (_listener: (e: unknown) => unknown) => ({ dispose() {} }),
};
const makeCache = () => new LicenseCache({ get() {}, keys: () => [], async update() {} });

const ENV_KEYS = ["GOPRIVATE", "GONOPROXY", "GONOSUMDB", "GOENV"] as const;
afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

// --- go.mod -----------------------------------------------------------------

test("go.mod requires are read from single lines and blocks, comments and quotes included", () => {
  const text = [
    "module example.com/app",
    "",
    "go 1.22",
    "toolchain go1.22.4",
    "",
    "require github.com/gorilla/mux v1.8.1",
    "",
    "require (",
    '\t"golang.org/x/text" v0.14.0 // indirect',
    "\tgithub.com/BurntSushi/toml `v1.3.2`",
    "\t// github.com/commented/out v1.0.0",
    "\tgithub.com/half/typed",
    ")",
    "",
    "require ()",
    "exclude github.com/gorilla/mux v1.8.0",
    "retract v0.1.0",
    "tool golang.org/x/tools/cmd/stringer",
  ].join("\r\n");

  expect(
    parseGoMod(text).map((entry) => [entry.name, entry.spec, entry.line, entry.declaration])
  ).toEqual([
    [
      "github.com/gorilla/mux",
      "v1.8.1",
      5,
      { kind: "module", path: "github.com/gorilla/mux", version: "v1.8.1", replaced: false },
    ],
    [
      "golang.org/x/text",
      "v0.14.0",
      8,
      { kind: "module", path: "golang.org/x/text", version: "v0.14.0", replaced: false },
    ],
    [
      "github.com/BurntSushi/toml",
      "v1.3.2",
      9,
      { kind: "module", path: "github.com/BurntSushi/toml", version: "v1.3.2", replaced: false },
    ],
    [
      "github.com/half/typed",
      "",
      11,
      { kind: "unknown", reason: "`require` takes a module path and a version" },
    ],
  ]);
});

test("replace directives redirect a require, an exact version winning over every version", () => {
  const text = [
    "require (",
    "\texample.com/a v1.0.0",
    "\texample.com/b v1.2.0",
    "\texample.com/c v1.0.0",
    "\texample.com/d v1.0.0",
    "\texample.com/e v1.0.0",
    ")",
    "replace (",
    "\texample.com/a => example.com/fork v1.0.1",
    "\texample.com/a v1.0.0 => example.com/exact v2.0.0",
    "\texample.com/b v1.1.0 => example.com/other v9.9.9",
    "\texample.com/c => ../c",
    "\texample.com/d => example.com/nover",
    ")",
    "replace example.com/e => C:\\src\\e",
  ].join("\n");

  expect(parseGoMod(text).map((entry) => entry.declaration)).toEqual([
    { kind: "module", path: "example.com/exact", version: "v2.0.0", replaced: true },
    // A replacement of some other version leaves this one alone
    { kind: "module", path: "example.com/b", version: "v1.2.0", replaced: false },
    { kind: "skipped", reason: "replaced with a local directory" },
    { kind: "unknown", reason: "a module `replace` target needs a version" },
    { kind: "skipped", reason: "replaced with a local directory" },
  ]);
});

test("the line tokenizer splits like modfile does", () => {
  expect(tokenizeLine('require ("a/b" v1.0.0)// x')).toEqual([
    "require",
    "(",
    "a/b",
    "v1.0.0",
    ")",
  ]);
  expect(tokenizeLine('"esc\\"aped" v1')).toEqual(['esc"aped', "v1"]);
  // An unterminated string ends the line instead of throwing
  expect(tokenizeLine('a "oops')).toEqual(["a"]);
  expect(tokenizeLine("   // only a comment")).toEqual([]);
});

test("module paths and versions are validated the way the go command does", () => {
  expect(isModulePath("github.com/gorilla/mux")).toBe(true);
  expect(isModulePath("gopkg.in/yaml.v3")).toBe(true);
  expect(isModulePath("github.com/BurntSushi/toml")).toBe(true);
  // No dot in the first element: standard library or a local-only module
  expect(isModulePath("example/app")).toBe(false);
  expect(isModulePath("GitHub.com/x/y")).toBe(false);
  expect(isModulePath("github.com/x/.hidden")).toBe(false);
  expect(isModulePath("github.com//y")).toBe(false);

  expect(isModuleVersion("v1.8.1")).toBe(true);
  expect(isModuleVersion("v0.0.0-20231006140011-7918f672742d")).toBe(true);
  expect(isModuleVersion("v24.0.7+incompatible")).toBe(true);
  expect(isModuleVersion("v1.0.0-rc.1")).toBe(true);
  // A version is exact and canonical, never a range or a bare SemVer
  expect(isModuleVersion("1.8.1")).toBe(false);
  expect(isModuleVersion("v1.8")).toBe(false);
  expect(isModuleVersion("v1.0.0+build")).toBe(false);
  expect(isModuleVersion("latest")).toBe(false);

  expect(isDirectoryPath("./x")).toBe(true);
  expect(isDirectoryPath("..\\x")).toBe(true);
  expect(isDirectoryPath("/abs")).toBe(true);
  expect(isDirectoryPath("D:x")).toBe(true);
  expect(isDirectoryPath("example.com/x")).toBe(false);
});

// --- GOPRIVATE --------------------------------------------------------------

test("private patterns match leading path elements the way module.MatchPrefixPatterns does", () => {
  expect(matchPrefixPatterns("corp.example.com", "corp.example.com/team/repo")).toBe(true);
  expect(matchPrefixPatterns("*.corp.example.com", "git.corp.example.com/repo")).toBe(true);
  expect(matchPrefixPatterns("*.corp.example.com", "corp.example.com/repo")).toBe(false);
  expect(matchPrefixPatterns("github.com/acme/*", "github.com/acme/secret/v2")).toBe(true);
  expect(matchPrefixPatterns("github.com/acme/*", "github.com/acme")).toBe(false);
  expect(matchPrefixPatterns(" , github.com/a?me", "github.com/acme/x")).toBe(true);
  expect(matchPrefixPatterns("github.com/[ab]cme", "github.com/bcme/x")).toBe(true);
  expect(matchPrefixPatterns("github.com/[^a]cme", "github.com/acme/x")).toBe(false);
  // A `*` never crosses a `/`
  expect(matchPrefixPatterns("github.*", "github.com/x")).toBe(true);
  expect(matchPrefixPatterns("github.com*", "github.com/x")).toBe(true);
  expect(matchPrefixPatterns("*", "github.com/x")).toBe(true);
  // Malformed patterns match nothing
  expect(matchPrefixPatterns("github.com/[acme", "github.com/[acme/x")).toBe(false);
  expect(matchPrefixPatterns("", "github.com/x")).toBe(false);

  expect(parseEnvFile("GOPRIVATE=corp.example.com\nGOFLAGS=-mod=mod\nnot a line\n")).toEqual(
    new Map([
      ["GOPRIVATE", "corp.example.com"],
      ["GOFLAGS", "-mod=mod"],
    ])
  );
});

// --- licenses ---------------------------------------------------------------

test("deps.dev licenses combine into one SPDX expression", () => {
  expect(combineLicenses(["MIT"])).toBe("MIT");
  expect(combineLicenses(["Apache-2.0", "MIT"])).toBe("Apache-2.0 AND MIT");
  expect(combineLicenses(["MIT", "MIT"])).toBe("MIT");
  expect(combineLicenses(["MIT OR Apache-2.0", "BSD-3-Clause"])).toBe(
    "(MIT OR Apache-2.0) AND BSD-3-Clause"
  );
  expect(combineLicenses(["non-standard"])).toBeUndefined();
  expect(combineLicenses(["non-standard", "MIT"])).toBe("MIT");
  expect(combineLicenses([])).toBeUndefined();
});

// --- the provider -----------------------------------------------------------

/** A fake filesystem plus a recorder of every deps.dev request, answering from `answers` by module path. */
function mount(files: Map<string, string>, answers: Record<string, unknown>) {
  const host = fakeHost(files);
  const calls: string[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: string) => {
    calls.push(url);
    const match = /\/packages\/([^/]+)\/versions\/([^/]+)$/.exec(url);
    const name = match ? decodeURIComponent(match[1]) : "";
    const version = match ? decodeURIComponent(match[2]) : "";
    const licenses = answers[name];
    if (licenses === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        versionKey: { system: "GO", name, version },
        licenses,
        links: [{ label: "SOURCE_REPO", url: `https://${name}` }],
      }),
    };
  }) as typeof fetch;
  return { host, calls, restore: () => (global.fetch = originalFetch) };
}

test("Go resolution looks each require up on deps.dev at the version replace leaves it at", async () => {
  process.env.GOENV = "off";
  const { host, calls, restore } = mount(new Map(), {
    "github.com/gorilla/mux": ["BSD-3-Clause"],
    "github.com/docker/docker": ["Apache-2.0", "MIT"],
    "example.com/fork": ["MIT"],
    "example.com/odd": ["non-standard"],
  });
  const cache = makeCache();
  const provider = new GoLicenseProvider(cache, host);

  const document = fakeDocument(
    [
      "require (",
      "\tgithub.com/gorilla/mux v1.8.1",
      "\tgithub.com/docker/docker v24.0.7+incompatible // indirect",
      "\texample.com/orig v1.0.0",
      "\texample.com/odd v0.1.0",
      "\texample.com/missing v1.0.0",
      ")",
      "replace example.com/orig => example.com/fork v1.0.1",
    ].join("\n"),
    "/repo/go.mod"
  );
  const entries = provider.parse(document);
  const resolved = [];
  for (const entry of entries) resolved.push(await provider.resolve(entry, document, noCancel));

  expect({ ...resolved[0] }).toEqual({
    source: "registry",
    license: "BSD-3-Clause",
    version: "v1.8.1",
    homepage: "https://github.com/gorilla/mux",
    packagePageUrl: "https://pkg.go.dev/github.com/gorilla/mux@v1.8.1",
    via: "deps.dev",
    detail: undefined,
  });
  // Two license files in one module: both apply
  expect(resolved[1].license).toBe("Apache-2.0 AND MIT");
  // A replaced module resolves, and links, as its replacement
  expect(resolved[2].license).toBe("MIT");
  expect(resolved[2].version).toBe("v1.0.1");
  expect(resolved[2].packagePageUrl).toBe("https://pkg.go.dev/example.com/fork@v1.0.1");
  expect(resolved[2].via).toBe("`replace` → `example.com/fork` + deps.dev");
  expect(resolved[3]).toMatchObject({
    source: "registry",
    license: undefined,
    detail: "deps.dev found a license it could not identify",
  });
  expect(resolved[4]).toEqual({
    source: "unknown",
    version: "v1.0.0",
    via: "deps.dev",
    detail: "deps.dev has no record of this module version",
  });
  // The `+` of +incompatible is escaped in the path
  expect(calls).toEqual([
    "https://api.deps.dev/v3/systems/go/packages/github.com%2Fgorilla%2Fmux/versions/v1.8.1",
    "https://api.deps.dev/v3/systems/go/packages/github.com%2Fdocker%2Fdocker/versions/v24.0.7%2Bincompatible",
    "https://api.deps.dev/v3/systems/go/packages/example.com%2Ffork/versions/v1.0.1",
    "https://api.deps.dev/v3/systems/go/packages/example.com%2Fodd/versions/v0.1.0",
    "https://api.deps.dev/v3/systems/go/packages/example.com%2Fmissing/versions/v1.0.0",
  ]);

  const hover = buildHover(entries[0], resolved[0])!.value;
  expect(hover).toMatch(
    /\[`github\.com\/gorilla\/mux@v1\.8\.1`\]\(https:\/\/pkg\.go\.dev\/github\.com\/gorilla\/mux@v1\.8\.1\)/
  );

  // A found version is cached, so asking again sends nothing
  calls.length = 0;
  expect((await provider.resolve(entries[0], document, noCancel)).license).toBe("BSD-3-Clause");
  expect(calls).toEqual([]);
  restore();
  cache.dispose();
});

test("private, local and malformed requires never reach deps.dev", async () => {
  process.env.GOPRIVATE = "corp.example.com";
  process.env.GOENV = "/goenv";
  const { host, calls, restore } = mount(new Map([["/goenv", "GONOSUMDB=github.com/acme\n"]]), {});
  const cache = makeCache();
  const provider = new GoLicenseProvider(cache, host);

  const document = fakeDocument(
    [
      "require (",
      "\tcorp.example.com/team/lib v1.0.0",
      "\tgithub.com/acme/secret v1.0.0",
      "\texample.com/local v1.0.0",
      "\texample/nodot v1.0.0",
      "\texample.com/bad 1.0.0",
      ")",
      "replace example.com/local => ./local",
    ].join("\n"),
    "/repo/go.mod"
  );
  const infos = [];
  for (const entry of provider.parse(document)) {
    infos.push(await provider.resolve(entry, document, noCancel));
  }

  expect(infos.map((info) => [info.source, info.detail])).toEqual([
    ["skipped", "private module (`GOPRIVATE`)"],
    // Read from the go env file, which `go env -w` writes
    ["skipped", "private module (`GOPRIVATE`)"],
    ["skipped", "replaced with a local directory"],
    ["unknown", "not a public module path"],
    ["unknown", "invalid version"],
  ]);
  expect(calls).toEqual([]);
  restore();
  cache.dispose();
});

test("only a project go.mod is recognized, and cache keys follow the declaration", () => {
  const cache = makeCache();
  const provider = new GoLicenseProvider(cache, fakeHost());
  cache.dispose();

  expect(provider.supports(fakeDocument("", "/repo/go.mod"))).toBe(true);
  expect(provider.supports(fakeDocument("", "/repo/sub/go.mod"))).toBe(true);
  expect(provider.supports(fakeDocument("", "/repo/go.sum"))).toBe(false);
  expect(provider.supports(fakeDocument("", "/repo/go.work"))).toBe(false);
  expect(
    provider.supports(fakeDocument("", "/home/u/go/pkg/mod/github.com/x/y@v1.0.0/go.mod"))
  ).toBe(false);

  const of = (text: string) =>
    provider.cacheKey(provider.parse(fakeDocument(text, "/a/go.mod"))[0]);
  const plain = of("require example.com/x v1.0.0");
  expect(plain).not.toBe(of("require example.com/x v1.0.1"));
  expect(plain).not.toBe(
    of("require example.com/x v1.0.0\nreplace example.com/x => example.com/y v1.0.0")
  );
  expect(plain).toBe(of("require example.com/x v1.0.0 // indirect"));
});
