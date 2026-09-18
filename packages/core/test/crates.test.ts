import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { LicenseCache } from "../src/cache";
import { getSetting } from "../src/config";
import { buildHover } from "../src/format";
import { RequestLimiter } from "../src/net";
import { CratesLicenseProvider } from "../src/providers/crates";
import { CratesClient } from "../src/providers/crates/client";
import { selectLocked } from "../src/providers/crates/lockfile";
import { dependencySpec, parseManifest } from "../src/providers/crates/parse";
import {
  compareVersions,
  matchesRequirement,
  parseRequirement,
} from "../src/providers/crates/spec";
import { CargoWorkspace, workspaceManifestUri } from "../src/providers/crates/workspace";
import {
  FakeCancellationTokenSource,
  fakeDocument,
  fakeHost,
  fakePath,
  fakeUri,
} from "./support/fakeHost";
import { setSettings } from "./support/vscodeStub";

declare const __dirname: string;

const noCancel = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
};
function makeCache() {
  return new LicenseCache({ get() {}, keys: () => [], async update() {} });
}
const lockText = (packages: [string, string, string?][]) =>
  "version = 4\n" +
  packages
    .map(
      ([name, version, source = "registry+https://github.com/rust-lang/crates.io-index"]) =>
        `[[package]]\nname="${name}"\nversion="${version}"\n${source ? `source="${source}"` : ""}\n`
    )
    .join("");
const apiVersion = (num: string, extra: Record<string, unknown> = {}) => ({
  crate: "real",
  num,
  license: "MIT OR Apache-2.0",
  yanked: false,
  ...extra,
});
const settle = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};

afterEach(() => {
  setSettings({});
});

test("Cargo requirements match the generated Rust semver 1.0.27 oracle", () => {
  const fixtures = join(__dirname, "..", "..", "..", "test", "fixtures", "lockfiles");
  const rows = readFileSync(join(fixtures, "cargo-versionreq.tsv"), "utf8")
    .replace(/^\uFEFF/, "")
    .trimEnd()
    .split(/\r?\n/);
  for (const row of rows) {
    const fields = row.split("\t");
    const expected = fields.pop();
    const v = fields.pop()!;
    const req = fields.join("\t");
    const parsed = parseRequirement(req);
    const result = parsed.kind === "invalid" ? "invalid" : String(matchesRequirement(parsed, v));
    expect(result, JSON.stringify([req, v])).toBe(expected);
  }
  const locked = readFileSync(`${fixtures}/cargo.Cargo.lock`, "utf8").replace(/^\uFEFF/, "");
  expect(selectLocked(locked, "semver", parseRequirement("1"))).toEqual({
    kind: "selected",
    version: "1.0.27",
  });
});

test("Cargo.lock validates every candidate's requirement and source", () => {
  const req = parseRequirement("1");
  for (const packages of [
    [["real", "2.0.0"]],
    [["real", "1.0.0", "git+https://example.com"]],
    [["real", "1.0.0", ""]],
    [["real", "1.0.0", "registry+https://private/index"]],
    [
      ["real", "1.0.0"],
      ["real", "1.1.0"],
    ],
  ] as [string, string, string?][][])
    expect(selectLocked(lockText(packages), "real", req).kind).toBe("fallback");
  expect(
    selectLocked(
      lockText([
        ["real", "1.0.0"],
        ["real", "2.0.0"],
      ]),
      "real",
      req
    )
  ).toEqual({ kind: "selected", version: "1.0.0" });
  expect(selectLocked("not toml", "real", req).kind).toBe("fallback");
});

test("Cargo provider inherits at the nearest root, isolates cache keys, and never sends excluded names", async () => {
  const files = new Map<string, string>();
  const host = fakeHost(files);
  const calls: string[] = [];
  vi.spyOn(global, "fetch").mockImplementation((async (url: string) => {
    calls.push(url);
    return {
      ok: true,
      json: async () => ({ version: apiVersion("1.0.0", { license: null, yanked: true }) }),
    };
  }) as typeof fetch);
  const cache = makeCache();
  onTestFinished(() => cache.dispose());
  const provider = new CratesLicenseProvider(cache, host);
  const doc = (text: string, path = "/root/member/Cargo.toml") => fakeDocument(text, path);
  const resolve = (d: ReturnType<typeof doc>) =>
    provider.resolve(provider.parse(d)[0], d, noCancel);
  files.set(
    "/root/Cargo.toml",
    '[workspace]\n[workspace.dependencies]\nalias={package="real",version="1"}\n[patch.crates-io]\nother={path="local"}'
  );
  files.set("/root/Cargo.lock", lockText([["real", "1.0.0"]]));
  let document = doc("[dependencies]\nalias.workspace=true");
  const info = await resolve(document);
  expect(info.version).toBe("1.0.0");
  expect(info.license).toBeUndefined();
  expect(info.source).toBe("registry");
  expect(info.via).toMatch(/Cargo.lock/);
  expect(calls, "missing locked license must not trigger a range lookup").toHaveLength(1);
  expect(buildHover(provider.parse(document)[0], info)!.value).toMatch(
    /https:\/\/crates.io\/crates\/real\/1.0.0/
  );
  const key = provider.cacheKey(provider.parse(document)[0]);
  expect(key).not.toBe(
    provider.cacheKey(provider.parse(doc(document.getText(), "/another/Cargo.toml"))[0])
  );
  expect(key).toBe(provider.cacheKey(provider.parse(doc("\n" + document.getText()))[0]));
  expect(key).not.toBe(
    provider.cacheKey(provider.parse(doc('[dependencies]\nalias={path="private",version="1"}'))[0])
  );
  for (const field of ["path", "git", "registry", "registry-index"])
    expect(
      (await resolve(doc(`[dependencies]\nprivate={${field}="secret",version="1"}`))).source
    ).toBe("skipped");
  expect((await resolve(doc('[dependencies]\nother="1"'))).source).toBe("skipped");
  files.set(
    "/root/nested/Cargo.toml",
    '[workspace]\n[workspace.dependencies]\nalias={git="private"}'
  );
  expect((await resolve(doc(document.getText(), "/root/nested/member/Cargo.toml"))).source).toBe(
    "skipped"
  );
  expect((await resolve(doc('[package]\nworkspace="missing"\n[dependencies]\na="1"'))).source).toBe(
    "unknown"
  );
  expect((await resolve(doc("[dependencies]\nmissing.workspace=true"))).source).toBe("unknown");
  // A member patch is ignored; only the effective root patch suppresses a public dependency.
  document = doc('[dependencies]\nalias.workspace=true\n[patch.crates-io]\nreal={path="local"}');
  expect((await resolve(document)).source).toBe("registry");
  files.set(
    "/root/Cargo.toml",
    '[workspace]\n[workspace.dependencies]\nalias={package="real",version="1"}\n[patch.crates-io]\nrenamed={package="real",path="local"}'
  );
  expect((await resolve(document)).source, "auxiliary reads are cached until Refresh/TTL").toBe(
    "registry"
  );
  provider.invalidate();
  expect((await resolve(document)).source).toBe("skipped");
  expect(calls).toHaveLength(1);
});

test("Cargo client validates complete lists, caches exact metadata and handles failures and cancellation", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout"], now: Date.now() + 100_000 });
  const cache = makeCache();
  onTestFinished(() => cache.dispose());
  const client = new CratesClient(cache);
  let enabled = true;
  let response: Record<string, unknown> = {
    versions: [
      apiVersion("1.0.0"),
      apiVersion("1.9.0", { yanked: true }),
      apiVersion("1.2.0", { license: null }),
    ],
    meta: { next_page: null },
  };
  let status = 200;
  const starts: [number, string][] = [];
  setSettings({ "packageLicenseViewer.crates.useRegistry": enabled });
  vi.spyOn(global, "fetch").mockImplementation((async (url: string, options: RequestInit) => {
    starts.push([Date.now(), url]);
    expect((options.headers as Record<string, string>)["User-Agent"]).toBe(
      "vscode-package-license-viewer"
    );
    return { ok: status === 200, status, json: async () => response };
  }) as typeof fetch);
  async function run<T>(promise: Promise<T>): Promise<T> {
    await settle();
    vi.advanceTimersByTime(61_000);
    await settle();
    return promise;
  }
  const req = parseRequirement("1");
  const [a, b] = await run(
    Promise.all([
      client.metadata("real", req, undefined, noCancel),
      client.metadata("real", req, undefined, noCancel),
    ])
  );
  expect(a).toEqual(b);
  expect((a as { metadata: { version: string } }).metadata.version).toBe("1.2.0");
  expect((a as { metadata: { license?: string } }).metadata.license).toBeUndefined();
  expect(starts).toHaveLength(1);
  expect(starts[0][1]).toMatch(/\/versions$/);
  expect((await client.metadata("real", req, "1.2.0", noCancel)).kind).toBe("found");
  enabled = false;
  setSettings({ "packageLicenseViewer.crates.useRegistry": enabled });
  expect((await client.metadata("real", req, undefined, noCancel)).kind).toBe("found");
  expect((await client.metadata("private", req, undefined, noCancel)).kind).toBe("unknown");
  expect(starts).toHaveLength(1);
  enabled = true;
  setSettings({ "packageLicenseViewer.crates.useRegistry": enabled });
  cache.clear();
  response = { versions: [apiVersion("1.0.0")], meta: { next_page: "?seek=next" } };
  expect((await run(client.metadata("real", req, undefined, noCancel))).kind).toBe("unknown");
  response = { versions: [apiVersion("1.0.0", { crate: "wrong" })] };
  expect((await run(client.metadata("real", req, undefined, noCancel))).kind).toBe("unknown");
  for (const failure of [404, 500, 429]) {
    status = failure;
    expect((await run(client.metadata("real", req, undefined, noCancel))).kind).toBe("unknown");
  }
  status = 200;
  response = { versions: [apiVersion("1.0.0")] };
  const count = starts.length;
  const cancelled = new FakeCancellationTokenSource();
  const pendingCancelled = client.metadata("real", req, undefined, cancelled.token);
  cancelled.cancel();
  expect((await run(pendingCancelled)).kind).toBe("unknown");
  expect(starts).toHaveLength(count);
  const first = new FakeCancellationTokenSource();
  const p1 = client.metadata("real", req, undefined, first.token);
  const p2 = client.metadata("real", req, undefined, noCancel);
  first.cancel();
  const results = await run(Promise.all([p1, p2]));
  expect(results[0].kind).toBe("unknown");
  expect(results[1].kind).toBe("found");
  expect(starts).toHaveLength(count + 1);
  for (let i = 1; i < starts.length; i++)
    expect(starts[i][0] - starts[i - 1][0]).toBeGreaterThanOrEqual(1000);
});

test("Cargo client treats - and _ as the same crate name, and skips a lone bad record without discarding the rest", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout"], now: Date.now() + 100_000 });
  const cache = makeCache();
  onTestFinished(() => cache.dispose());
  const client = new CratesClient(cache);
  setSettings({});
  let response: Record<string, unknown>;
  vi.spyOn(global, "fetch").mockImplementation((async () => ({
    ok: true,
    status: 200,
    json: async () => response,
  })) as unknown as typeof fetch);
  // CratesRateLimiter is a module-level singleton shared by every test in this file, so its
  // `nextStart` may already be far ahead of this test's own mocked clock (e.g. left there by
  // the 429 case in the test above). Tick in a loop instead of a single fixed amount, so this
  // test doesn't depend on exactly how much delay earlier tests happened to leave behind.
  async function run<T>(promise: Promise<T>): Promise<T> {
    for (let i = 0; i < 40; i++) await Promise.resolve();
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(60_000);
      for (let j = 0; j < 40; j++) await Promise.resolve();
    }
    return promise;
  }

  // crates.io reports the canonical "foo-bar" spelling even when Cargo.toml wrote "foo_bar".
  response = { versions: [{ ...apiVersion("1.0.0"), crate: "foo-bar" }] };
  const req = parseRequirement("1");
  const underscored = (await run(client.metadata("foo_bar", req, undefined, noCancel))) as {
    kind: string;
    metadata: { version: string };
  };
  expect(underscored.kind).toBe("found");
  expect(underscored.metadata.version).toBe("1.0.0");

  // One malformed record among otherwise-good ones shouldn't take the whole list down with it.
  response = { versions: [apiVersion("1.0.0", { crate: "not-real" }), apiVersion("1.5.0")] };
  const partial = (await run(client.metadata("real", req, undefined, noCancel))) as {
    kind: string;
    metadata: { version: string };
  };
  expect(partial.kind).toBe("found");
  expect(partial.metadata.version).toBe("1.5.0");

  // If every record fails to decode, that's treated as a failed fetch (and not cached), not a
  // confirmed-empty version list.
  cache.clear();
  response = { versions: [apiVersion("1.0.0", { crate: "not-real" })] };
  const allBad = await run(client.metadata("real", req, undefined, noCancel));
  expect(allBad.kind).toBe("unknown");
  response = { versions: [apiVersion("1.0.0")] };
  const retried = await run(client.metadata("real", req, undefined, noCancel));
  expect(retried.kind, "a later call should retry rather than reuse a bad cache entry").toBe(
    "found"
  );
});

test("Cargo rate limiter spaces actual starts, skips queued cancellation and checks disabled settings", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout"], now: 1000 });
  // Same construction as providers/crates/client.ts's module-level `limiter`.
  const limiter = new RequestLimiter(1000, 60_000, () => getSetting("crates.useRegistry", true));
  const starts: number[] = [];
  const send = async () => {
    starts.push(Date.now());
    return true;
  };
  await limiter.run(noCancel, send);
  const cts = new FakeCancellationTokenSource();
  const cancelled = limiter.run(cts.token, send).catch(() => false);
  const next = limiter.run(noCancel, send);
  await settle();
  cts.cancel();
  await settle();
  vi.advanceTimersByTime(999);
  await settle();
  expect(starts).toHaveLength(1);
  vi.advanceTimersByTime(1);
  await settle();
  await next;
  expect(await cancelled).toBe(false);
  expect(starts).toEqual([1000, 2000]);
  const blocked = limiter.run(noCancel, send).catch(() => false);
  await settle();
  setSettings({ "packageLicenseViewer.crates.useRegistry": false });
  vi.advanceTimersByTime(1000);
  await settle();
  expect(await blocked).toBe(false);
  expect(starts).toHaveLength(2);
});

test("Cargo timeout and Refresh never persist transient failures or stale in-flight metadata", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout"], now: Date.now() + 10_000_000 });
  const cache = makeCache();
  onTestFinished(() => cache.dispose());
  const client = new CratesClient(cache);
  let calls = 0;
  vi.spyOn(global, "fetch").mockImplementation((async (_url: string, options: RequestInit) => {
    calls++;
    return new Promise((_resolve, reject) =>
      options.signal!.addEventListener("abort", () =>
        reject((options.signal as AbortSignal).reason)
      )
    );
  }) as typeof fetch);
  const pending = client.metadata("real", parseRequirement("1"), "1.0.0", noCancel);
  await settle();
  vi.advanceTimersByTime(8000);
  await settle();
  expect((await pending).kind).toBe("unknown");
  expect(cache.get("crates:metadata:v1:real@1.0.0")).toBeUndefined();
  const refreshed = client.metadata("real", parseRequirement("1"), "1.0.0", noCancel);
  await settle();
  client.invalidate();
  await settle();
  expect((await refreshed).kind).toBe("unknown");
  expect(calls).toBe(2);
  expect(cache.get("crates:metadata:v1:real@1.0.0")).toBeUndefined();
});

test("Cargo explicit workspace roots and separate lockfiles use distinct public metadata", async () => {
  const cache = makeCache();
  onTestFinished(() => cache.dispose());
  for (const version of ["1.0.0", "1.1.0"])
    cache.set(`crates:metadata:v1:real@${version}`, {
      version,
      license: version === "1.0.0" ? "MIT" : "ISC",
      yanked: false,
    });
  const files = new Map([
    ["/a/Cargo.lock", lockText([["real", "1.0.0"]])],
    ["/b/Cargo.lock", lockText([["real", "1.1.0"]])],
    ["/b/Cargo.toml", '[workspace]\n[workspace.dependencies]\nalias={package="real",version="1"}'],
  ]);
  const host = fakeHost(files);
  vi.spyOn(global, "fetch").mockImplementation((() => {
    throw new Error("unexpected network");
  }) as unknown as typeof fetch);
  const provider = new CratesLicenseProvider(cache, host);
  const a = fakeDocument('[dependencies]\nalias={package="real",version="1"}', "/a/Cargo.toml");
  const b = fakeDocument(
    '[package]\nworkspace="../b"\n[dependencies]\nalias.workspace=true',
    "/else/Cargo.toml"
  );
  const results = await Promise.all(
    [a, b].map((d) => provider.resolve(provider.parse(d)[0], d, noCancel))
  );
  expect(results.map((r) => [r.version, r.license])).toEqual([
    ["1.0.0", "MIT"],
    ["1.1.0", "ISC"],
  ]);
  expect(provider.cacheKey(provider.parse(a)[0])).not.toBe(provider.cacheKey(provider.parse(b)[0]));
  const deep = fakeDocument('[dependencies]\nreal="1"', "/" + "nested/".repeat(70) + "Cargo.toml");
  const unresolved = await provider.resolve(provider.parse(deep)[0], deep, noCancel);
  expect(unresolved.source).toBe("unknown");
  expect(unresolved.detail).toMatch(/search limit/);
});

test("Cargo TOML forms preserve aliases, sections and declaration start lines", () => {
  const text = `[dependencies]
a = "1"
"quoted-name" = { package = "real", version = "2", optional = true }
b.version = "3"
[dev-dependencies.c]
version = "4"
features = [
 "one",
]
[target.'cfg(unix)'.build-dependencies]
d = "5"
[workspace.dependencies]
e = "6"
[package.metadata.dependencies]
hidden = "7"`;
  const parsed = parseManifest(text, "file:///Cargo.toml");
  expect(parsed).toBeTruthy();
  expect(parsed!.entries.map((e) => [e.name, e.line])).toEqual([
    ["a", 1],
    ["quoted-name", 2],
    ["b", 3],
    ["c", 4],
    ["d", 10],
    ["e", 12],
  ]);
  expect((parsed!.entries[1].declaration as { name: string }).name).toBe("real");
  expect(parsed!.entries[4].section).toBe("target.cfg(unix).build-dependencies");
});

test("Cargo inline sections and multiline strings use the start line", () => {
  const parsed = parseManifest('dependencies = { a = "1", b = { version = "2" } }\n', "a");
  expect(parsed!.entries.map((e) => e.name)).toEqual(["a", "b"]);
  expect(parseManifest('[dependencies]\na = """1\n"""', "a")!.entries[0].line).toBe(1);
  for (const text of ['[dependencies\na="1"', '[dependencies]\na="1"\na="2"'])
    expect(parseManifest(text, "a")).toBeUndefined();
});

test("Cargo sources, inheritance and conflicts are explicit", () => {
  for (const source of ["path", "git", "registry", "registry-index"]) {
    expect(dependencySpec("private", { version: "1", [source]: "secret" }).kind).toBe("skipped");
  }
  expect(dependencySpec("a", { workspace: true }).kind).toBe("workspace");
  for (const value of [
    { workspace: false },
    { workspace: true, version: "1" },
    { package: 3, version: "1" },
    {},
  ])
    expect(dependencySpec("a", value).kind).toBe("unknown");
  const parsed = parseManifest(
    '[workspace]\n[patch.crates-io]\nalias={package="real",path="local"}\n[replace]\n"other:1.0.0"={path="other"}',
    "a"
  );
  expect(parsed!.overrides).toEqual(["other", "real"]);
});

test("Cargo requirement semantics differ from npm and match Rust VersionReq", () => {
  const cases: [string, string, boolean][] = [
    ["1.2.3", "1.9.0", true],
    ["=1.2.3", "1.9.0", false],
    ["0.2", "0.3.0", false],
    ["0.0", "0.0.9", true],
    ["0", "0.9.0", true],
    ["0.0.3", "0.0.4", false],
    ["^0.2.3", "0.2.9", true],
    ["~1.2", "1.3.0", false],
    ["~1", "1.9.0", true],
    [">1.2", "1.2.99", false],
    [">1.2", "1.3.0", true],
    ["<=1.2", "1.2.99", true],
    ["<1.2", "1.2.0-alpha", false],
    [">=1.2, <2", "1.8.0", true],
    ["1.*", "1.9.0", true],
    ["1.x.*", "2.0.0", false],
    ["=1.2", "1.2.99", true],
    ["*", "1.0.0-alpha", false],
    ["1.0.0-alpha", "1.0.0-beta", true],
    ["1.0.0-alpha", "1.0.1-alpha", false],
    ["1.0.0-alpha", "1.1.0", true],
    [">=1.0.0-alpha, <1.1", "1.0.0-alpha.2", true],
    ["=1.0.0+build", "1.0.0+other", true],
    ["1.0.0-exp", "1.0.0", true],
    ["18446744073709551615", "18446744073709551615.0.0", true],
  ];
  for (const [req, v, expected] of cases)
    expect(matchesRequirement(parseRequirement(req), v), `${req}: ${v}`).toBe(expected);
  for (const req of [
    "",
    "latest",
    "1 || 2",
    "1 - 2",
    "1.2.3 2",
    "01",
    "1.02",
    "1.0.0-01",
    "1.0-alpha",
    "1.*.2",
    "*,1",
    "1,",
    "1\t",
    "1\n",
    "1\r\n",
    "18446744073709551616",
  ])
    expect(parseRequirement(req).kind, req).toBe("invalid");
  expect(compareVersions("1.0.0-alpha.9", "1.0.0-alpha.10")).toBe(-1);
  expect(compareVersions("1.0.0+a", "1.0.0+b")).toBe(0);
});

test("explicit absolute Cargo workspace roots are not appended to the member directory", async () => {
  const requested: string[] = [];
  const host = fakeHost();
  vi.spyOn(host.fs, "readFile").mockImplementation(async (uri) => {
    requested.push(uri.path);
    if (uri.path === "/ws/Cargo.toml")
      return new TextEncoder().encode('[workspace]\n[workspace.dependencies]\nreal="1"');
    throw Object.assign(new Error("missing"), { code: "FileNotFound" });
  });
  const document = fakeDocument('[package]\nworkspace="/ws"', "/app/Cargo.toml");
  const result = await new CargoWorkspace(host.fs).root(
    fakeUri("/app/Cargo.toml"),
    parseManifest(document.getText(), document.uri)!
  );
  expect(result.kind).toBe("found");
  expect(requested).toEqual(["/ws/Cargo.toml"]);
});

test("offline locked metadata reuses exact records from a fresh version list", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout"], now: Date.now() });
  setSettings({ "packageLicenseViewer.crates.useRegistry": false });
  const http = vi.spyOn(global, "fetch").mockImplementation((() => {
    throw new Error("unexpected HTTP");
  }) as unknown as typeof fetch);
  const cache = makeCache();
  onTestFinished(() => cache.dispose());
  const client = new CratesClient(cache);
  for (const metadata of [
    { version: "1.0.0", license: "MIT", yanked: false },
    { version: "1.0.0", license: "MIT", yanked: true },
    { version: "1.0.0", yanked: true },
  ]) {
    cache.clear();
    cache.set("crates:versions:v1:real", [
      metadata,
      { version: "1.2.0", license: "ISC", yanked: false },
    ]);
    const result = await client.metadata("real", parseRequirement("1"), "1.0.0", noCancel);
    expect(result).toEqual({ kind: "found", metadata });
    expect((await client.metadata("real", parseRequirement("1"), "1.0.1", noCancel)).kind).toBe(
      "unknown"
    );
  }
  vi.advanceTimersByTime(168 * 60 * 60 * 1000 + 1);
  expect((await client.metadata("real", parseRequirement("1"), "1.0.0", noCancel)).kind).toBe(
    "unknown"
  );
  expect(http).not.toHaveBeenCalled();
});

test("root replace Package IDs exclude only the referenced crates.io name", async () => {
  const host = fakeHost();
  const cache = makeCache();
  onTestFinished(() => cache.dispose());
  const calls: string[] = [];
  vi.spyOn(CratesClient.prototype, "metadata").mockImplementation(async (name: string) => {
    calls.push(name);
    return { kind: "found", metadata: { version: "1.0.0", license: "MIT", yanked: false } };
  });
  const http = vi.spyOn(global, "fetch").mockImplementation((() => {
    throw new Error("unexpected HTTP");
  }) as unknown as typeof fetch);
  for (const [id, excluded] of [
    ["real:1.0.0", true],
    ["real@1.0.0", true],
    ["https://github.com/rust-lang/crates.io-index#real@1.0.0", true],
    ["registry+https://github.com/rust-lang/crates.io-index#real@1.0.0", true],
    ["registry+https://github.com/rust-lang/crates.io-index#real:1.0.0", true],
    ["git+https://github.com/rust-lang/crates.io-index#real@1.0.0", false],
    ["registry+https://private.example/index#real@1.0.0", false],
    ["git+https://example.com/real#real@1.0.0", false],
    ["other@1.0.0", false],
  ] as [string, boolean][]) {
    calls.length = 0;
    const document = fakeDocument(
      `[workspace]\n[dependencies]\nalias={package="real",version="1"}\nunrelated="1"\n[replace]\n"${id}"={path="../private"}`,
      "/replace/Cargo.toml"
    );
    const provider = new CratesLicenseProvider(cache, host);
    const [entry, unrelated] = provider.parse(document);
    expect((await provider.resolve(entry, document, noCancel)).source, id).toBe(
      excluded ? "skipped" : "registry"
    );
    expect(calls, id).toEqual(excluded ? [] : ["real"]);
    expect((await provider.resolve(unrelated, document, noCancel)).source).toBe("registry");
  }
  expect(http).not.toHaveBeenCalled();
});

test("Windows UNC variants stop before any workspace file read", async () => {
  const host = fakeHost();
  const reads = vi
    .spyOn(host.fs, "readFile")
    .mockImplementation(async () => new TextEncoder().encode("[workspace]"));
  for (const reference of [
    "//server/share/ws",
    "/\\server/share/ws",
    "\\/server/share/ws",
    "\\\\server\\share\\ws",
    "//?/C:/ws",
    "//./C:/ws",
  ]) {
    const directory = fakeUri(fakePath("/C:/app"));
    expect(workspaceManifestUri(directory, reference), reference).toBeUndefined();
    const document = fakeDocument(`[package]\nworkspace='${reference}'`, "/C:/app/Cargo.toml");
    const root = await new CargoWorkspace(host.fs).root(
      fakeUri(fakePath("/C:/app/Cargo.toml")),
      parseManifest(document.getText(), document.uri)!
    );
    expect(root.kind, reference).toBe("unknown");
  }
  expect(reads).not.toHaveBeenCalled();
  expect(workspaceManifestUri(fakeUri(fakePath("/app")), "name\\part")?.path).toBe(
    "/app/name\\part/Cargo.toml"
  );
  expect(workspaceManifestUri(fakeUri(fakePath("/app")), "/\\name")?.path).toBe(
    "/\\name/Cargo.toml"
  );
});

test("root patches recognize trailing index slashes without suppressing other sources", async () => {
  const host = fakeHost();
  const cache = makeCache();
  onTestFinished(() => cache.dispose());
  const calls: string[] = [];
  vi.spyOn(CratesClient.prototype, "metadata").mockImplementation(async (name: string) => {
    calls.push(name);
    return { kind: "unknown", reason: "mock lookup" };
  });
  for (const [source, excluded] of [
    ["crates-io", true],
    ["https://github.com/rust-lang/crates.io-index", true],
    ["https://github.com/rust-lang/crates.io-index/", true],
    ["https://private.example/index/", false],
    ["https://github.com/rust-lang/crates.io-index/other", false],
  ] as [string, boolean][]) {
    calls.length = 0;
    const document = fakeDocument(
      `[workspace]\n[dependencies]\nreal="1"\nother="1"\n[patch."${source}"]\nalias={package="real",path="local"}`,
      "/patch/Cargo.toml"
    );
    const provider = new CratesLicenseProvider(cache, host);
    const [entry, other] = provider.parse(document);
    expect((await provider.resolve(entry, document, noCancel)).source, source).toBe(
      excluded ? "skipped" : "unknown"
    );
    expect(calls).toEqual(excluded ? [] : ["real"]);
    await provider.resolve(other, document, noCancel);
    expect(calls.at(-1)).toBe("other");
  }
});

test("range cache reuse preserves the original metadata expiry online and offline", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout"], now: Date.now() });
  let online = false;
  setSettings({ "packageLicenseViewer.crates.useRegistry": online });
  const http = vi.spyOn(global, "fetch").mockImplementation((() => {
    throw new Error("unexpected HTTP");
  }) as unknown as typeof fetch);
  const cache = makeCache();
  onTestFinished(() => cache.dispose());
  const client = new CratesClient(cache);
  const metadata = { version: "1.0.0", license: "MIT", yanked: false };
  for (const seedExact of [false, true]) {
    cache.clear();
    cache.set("crates:versions:v1:real", [metadata]);
    if (seedExact) cache.set("crates:metadata:v1:real@1.0.0", metadata);
    vi.advanceTimersByTime(167 * 3600000);
    for (online of [false, true]) {
      setSettings({ "packageLicenseViewer.crates.useRegistry": online });
      expect((await client.metadata("real", parseRequirement("1"), undefined, noCancel)).kind).toBe(
        "found"
      );
    }
    online = false;
    setSettings({ "packageLicenseViewer.crates.useRegistry": online });
    expect((await client.metadata("real", parseRequirement("1"), "1.0.0", noCancel)).kind).toBe(
      "found"
    );
    vi.advanceTimersByTime(2 * 3600000);
    expect((await client.metadata("real", parseRequirement("1"), "1.0.0", noCancel)).kind).toBe(
      "unknown"
    );
  }
  expect(http).not.toHaveBeenCalled();
});
