const { fakeDocument, stub, fakeEditor, setVisibleEditors } = require("./vscode-stub");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { parseManifest, dependencySpec } = require("../out/providers/crates/parse");
const {
  parseRequirement,
  matchesRequirement,
  compareVersions,
} = require("../out/providers/crates/spec");
const { CratesLicenseProvider } = require("../out/providers/crates");
const { CratesClient, CratesRateLimiter } = require("../out/providers/crates/client");
const { selectLocked } = require("../out/providers/crates/lockfile");
const { LicenseCache } = require("../out/cache");
const { buildHover } = require("../out/format");
const { Annotator } = require("../out/annotator");
const { vscodeFileSystem } = require("../out/vscodeFs");
const noCancel = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
};
function makeCache() {
  return new LicenseCache({ get() {}, async update() {} });
}
const lockText = (packages) =>
  "version = 4\n" +
  packages
    .map(
      ([name, version, source = "registry+https://github.com/rust-lang/crates.io-index"]) =>
        `[[package]]\nname="${name}"\nversion="${version}"\n${source ? `source="${source}"` : ""}\n`
    )
    .join("");
const apiVersion = (num, extra = {}) => ({
  crate: "real",
  num,
  license: "MIT OR Apache-2.0",
  yanked: false,
  ...extra,
});
const settle = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};

test("Cargo requirements match the generated Rust semver 1.0.27 oracle", () => {
  const rows = fs
    .readFileSync(path.join(__dirname, "fixtures/lockfiles/cargo-versionreq.tsv"), "utf8")
    .replace(/^\uFEFF/, "")
    .trimEnd()
    .split(/\r?\n/);
  for (const row of rows) {
    const fields = row.split("\t");
    const expected = fields.pop();
    const v = fields.pop();
    const req = fields.join("\t");
    const parsed = parseRequirement(req);
    const result = parsed.kind === "invalid" ? "invalid" : String(matchesRequirement(parsed, v));
    assert.equal(result, expected, JSON.stringify([req, v]));
  }
  const locked = fs
    .readFileSync(path.join(__dirname, "fixtures/lockfiles/cargo.Cargo.lock"), "utf8")
    .replace(/^\uFEFF/, "");
  assert.deepEqual(selectLocked(locked, "semver", parseRequirement("1")), {
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
  ])
    assert.equal(selectLocked(lockText(packages), "real", req).kind, "fallback");
  assert.deepEqual(
    selectLocked(
      lockText([
        ["real", "1.0.0"],
        ["real", "2.0.0"],
      ]),
      "real",
      req
    ),
    { kind: "selected", version: "1.0.0" }
  );
  assert.equal(selectLocked("not toml", "real", req).kind, "fallback");
});

test("Cargo provider inherits at the nearest root, isolates cache keys, and never sends excluded names", async (t) => {
  const files = new Map();
  t.mock.method(stub.workspace.fs, "readFile", async (uri) => {
    if (!files.has(uri.path)) throw Object.assign(new Error("missing"), { code: "FileNotFound" });
    return Buffer.from(files.get(uri.path));
  });
  const calls = [];
  t.mock.method(global, "fetch", async (url) => {
    calls.push(url);
    return {
      ok: true,
      json: async () => ({ version: apiVersion("1.0.0", { license: null, yanked: true }) }),
    };
  });
  const cache = makeCache();
  t.after(() => cache.dispose());
  const provider = new CratesLicenseProvider(cache);
  const doc = (text, path = "/root/member/Cargo.toml") => fakeDocument(text, path);
  const resolve = (d) => provider.resolve(provider.parse(d)[0], d, noCancel);
  files.set(
    "/root/Cargo.toml",
    '[workspace]\n[workspace.dependencies]\nalias={package="real",version="1"}\n[patch.crates-io]\nother={path="local"}'
  );
  files.set("/root/Cargo.lock", lockText([["real", "1.0.0"]]));
  let document = doc("[dependencies]\nalias.workspace=true");
  const info = await resolve(document);
  assert.equal(info.version, "1.0.0");
  assert.equal(info.license, undefined);
  assert.equal(info.source, "registry");
  assert.match(info.via, /Cargo.lock/);
  assert.equal(calls.length, 1, "missing locked license must not trigger a range lookup");
  assert.match(
    buildHover(provider.parse(document)[0], info).value,
    /https:\/\/crates.io\/crates\/real\/1.0.0/
  );
  const key = provider.cacheKey(provider.parse(document)[0]);
  assert.notEqual(
    key,
    provider.cacheKey(provider.parse(doc(document.getText(), "/another/Cargo.toml"))[0])
  );
  assert.equal(key, provider.cacheKey(provider.parse(doc("\n" + document.getText()))[0]));
  assert.notEqual(
    key,
    provider.cacheKey(provider.parse(doc('[dependencies]\nalias={path="private",version="1"}'))[0])
  );
  for (const field of ["path", "git", "registry", "registry-index"])
    assert.equal(
      (await resolve(doc(`[dependencies]\nprivate={${field}="secret",version="1"}`))).source,
      "skipped"
    );
  assert.equal((await resolve(doc('[dependencies]\nother="1"'))).source, "skipped");
  files.set(
    "/root/nested/Cargo.toml",
    '[workspace]\n[workspace.dependencies]\nalias={git="private"}'
  );
  assert.equal(
    (await resolve(doc(document.getText(), "/root/nested/member/Cargo.toml"))).source,
    "skipped"
  );
  assert.equal(
    (await resolve(doc('[package]\nworkspace="missing"\n[dependencies]\na="1"'))).source,
    "unknown"
  );
  assert.equal((await resolve(doc("[dependencies]\nmissing.workspace=true"))).source, "unknown");
  // A member patch is ignored; only the effective root patch suppresses a public dependency.
  document = doc('[dependencies]\nalias.workspace=true\n[patch.crates-io]\nreal={path="local"}');
  assert.equal((await resolve(document)).source, "registry");
  files.set(
    "/root/Cargo.toml",
    '[workspace]\n[workspace.dependencies]\nalias={package="real",version="1"}\n[patch.crates-io]\nrenamed={package="real",path="local"}'
  );
  assert.equal(
    (await resolve(document)).source,
    "registry",
    "auxiliary reads are cached until Refresh/TTL"
  );
  provider.invalidate();
  assert.equal((await resolve(document)).source, "skipped");
  assert.equal(calls.length, 1);
});

test("Cargo client validates complete lists, caches exact metadata and handles failures and cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() + 100_000 });
  const cache = makeCache();
  t.after(() => cache.dispose());
  const client = new CratesClient(cache);
  let enabled = true,
    response = {
      versions: [
        apiVersion("1.0.0"),
        apiVersion("1.9.0", { yanked: true }),
        apiVersion("1.2.0", { license: null }),
      ],
      meta: { next_page: null },
    };
  let status = 200;
  const starts = [];
  t.mock.method(stub.workspace, "getConfiguration", () => ({
    get: (key, fallback) => (key === "crates.useRegistry" ? enabled : fallback),
  }));
  t.mock.method(global, "fetch", async (url, options) => {
    starts.push([Date.now(), url]);
    assert.equal(options.headers["User-Agent"], "vscode-package-license-viewer");
    return { ok: status === 200, status, json: async () => response };
  });
  async function run(promise) {
    await settle();
    t.mock.timers.tick(61_000);
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
  assert.deepEqual(a, b);
  assert.equal(a.metadata.version, "1.2.0");
  assert.equal(a.metadata.license, undefined);
  assert.equal(starts.length, 1);
  assert.match(starts[0][1], /\/versions$/);
  assert.equal((await client.metadata("real", req, "1.2.0", noCancel)).kind, "found");
  enabled = false;
  assert.equal((await client.metadata("real", req, undefined, noCancel)).kind, "found");
  assert.equal((await client.metadata("private", req, undefined, noCancel)).kind, "unknown");
  assert.equal(starts.length, 1);
  enabled = true;
  cache.clear();
  response = { versions: [apiVersion("1.0.0")], meta: { next_page: "?seek=next" } };
  assert.equal((await run(client.metadata("real", req, undefined, noCancel))).kind, "unknown");
  response = { versions: [apiVersion("1.0.0", { crate: "wrong" })] };
  assert.equal((await run(client.metadata("real", req, undefined, noCancel))).kind, "unknown");
  for (const failure of [404, 500, 429]) {
    status = failure;
    assert.equal((await run(client.metadata("real", req, undefined, noCancel))).kind, "unknown");
  }
  status = 200;
  response = { versions: [apiVersion("1.0.0")] };
  const count = starts.length;
  const cancelled = new stub.CancellationTokenSource();
  const pending = client.metadata("real", req, undefined, cancelled.token);
  cancelled.cancel();
  assert.equal((await run(pending)).kind, "unknown");
  assert.equal(starts.length, count);
  const first = new stub.CancellationTokenSource();
  const p1 = client.metadata("real", req, undefined, first.token);
  const p2 = client.metadata("real", req, undefined, noCancel);
  first.cancel();
  const results = await run(Promise.all([p1, p2]));
  assert.equal(results[0].kind, "unknown");
  assert.equal(results[1].kind, "found");
  assert.equal(starts.length, count + 1);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i][0] - starts[i - 1][0] >= 1000);
});

test("Cargo client treats - and _ as the same crate name, and skips a lone bad record without discarding the rest", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() + 100_000 });
  const cache = makeCache();
  t.after(() => cache.dispose());
  const client = new CratesClient(cache);
  t.mock.method(stub.workspace, "getConfiguration", () => ({
    get: (_key, fallback) => fallback,
  }));
  let response;
  t.mock.method(global, "fetch", async () => ({
    ok: true,
    status: 200,
    json: async () => response,
  }));
  // CratesRateLimiter is a module-level singleton shared by every test in this file, so its
  // `nextStart` may already be far ahead of this test's own mocked clock (e.g. left there by
  // the 429 case in the test above). Tick in a loop instead of a single fixed amount, so this
  // test doesn't depend on exactly how much delay earlier tests happened to leave behind.
  async function run(promise) {
    for (let i = 0; i < 40; i++) await Promise.resolve();
    for (let i = 0; i < 20; i++) {
      t.mock.timers.tick(60_000);
      for (let j = 0; j < 40; j++) await Promise.resolve();
    }
    return promise;
  }

  // crates.io reports the canonical "foo-bar" spelling even when Cargo.toml wrote "foo_bar".
  response = { versions: [{ ...apiVersion("1.0.0"), crate: "foo-bar" }] };
  const req = parseRequirement("1");
  const underscored = await run(client.metadata("foo_bar", req, undefined, noCancel));
  assert.equal(underscored.kind, "found");
  assert.equal(underscored.metadata.version, "1.0.0");

  // One malformed record among otherwise-good ones shouldn't take the whole list down with it.
  response = {
    versions: [apiVersion("1.0.0", { crate: "not-real" }), apiVersion("1.5.0")],
  };
  const partial = await run(client.metadata("real", req, undefined, noCancel));
  assert.equal(partial.kind, "found");
  assert.equal(partial.metadata.version, "1.5.0");

  // If every record fails to decode, that's treated as a failed fetch (and not cached), not a
  // confirmed-empty version list.
  cache.clear();
  response = { versions: [apiVersion("1.0.0", { crate: "not-real" })] };
  const allBad = await run(client.metadata("real", req, undefined, noCancel));
  assert.equal(allBad.kind, "unknown");
  response = { versions: [apiVersion("1.0.0")] };
  const retried = await run(client.metadata("real", req, undefined, noCancel));
  assert.equal(
    retried.kind,
    "found",
    "a later call should retry rather than reuse a bad cache entry"
  );
});

test("Cargo rate limiter spaces actual starts, skips queued cancellation and checks disabled settings", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const limiter = new CratesRateLimiter();
  const starts = [];
  const send = async () => {
    starts.push(Date.now());
    return true;
  };
  await limiter.run(noCancel, send);
  const cts = new stub.CancellationTokenSource();
  const cancelled = limiter.run(cts.token, send).catch(() => false);
  const next = limiter.run(noCancel, send);
  await settle();
  cts.cancel();
  await settle();
  t.mock.timers.tick(999);
  await settle();
  assert.equal(starts.length, 1);
  t.mock.timers.tick(1);
  await settle();
  await next;
  assert.equal(await cancelled, false);
  assert.deepEqual(starts, [1000, 2000]);
  const blocked = limiter.run(noCancel, send).catch(() => false);
  await settle();
  t.mock.method(stub.workspace, "getConfiguration", () => ({
    get: (key, fallback) => (key === "crates.useRegistry" ? false : fallback),
  }));
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(await blocked, false);
  assert.equal(starts.length, 2);
});

test("Cargo timeout and Refresh never persist transient failures or stale in-flight metadata", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() + 10_000_000 });
  const cache = makeCache();
  t.after(() => cache.dispose());
  const client = new CratesClient(cache);
  let calls = 0;
  t.mock.method(global, "fetch", async (_url, options) => {
    calls++;
    return new Promise((_resolve, reject) =>
      options.signal.addEventListener("abort", () => reject(options.signal.reason))
    );
  });
  const pending = client.metadata("real", parseRequirement("1"), "1.0.0", noCancel);
  await settle();
  t.mock.timers.tick(8000);
  await settle();
  assert.equal((await pending).kind, "unknown");
  assert.equal(cache.get("crates:metadata:v1:real@1.0.0"), undefined);
  const refreshed = client.metadata("real", parseRequirement("1"), "1.0.0", noCancel);
  await settle();
  client.invalidate();
  await settle();
  assert.equal((await refreshed).kind, "unknown");
  assert.equal(calls, 2);
  assert.equal(cache.get("crates:metadata:v1:real@1.0.0"), undefined);
});

test("Cargo explicit workspace roots and separate lockfiles use distinct public metadata", async (t) => {
  const cache = makeCache();
  t.after(() => cache.dispose());
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
  t.mock.method(stub.workspace.fs, "readFile", async (uri) => {
    if (!files.has(uri.path)) throw Object.assign(new Error("missing"), { code: "FileNotFound" });
    return Buffer.from(files.get(uri.path));
  });
  t.mock.method(global, "fetch", () => {
    throw new Error("unexpected network");
  });
  const provider = new CratesLicenseProvider(cache);
  const a = fakeDocument('[dependencies]\nalias={package="real",version="1"}', "/a/Cargo.toml");
  const b = fakeDocument(
    '[package]\nworkspace="../b"\n[dependencies]\nalias.workspace=true',
    "/else/Cargo.toml"
  );
  const results = await Promise.all(
    [a, b].map((d) => provider.resolve(provider.parse(d)[0], d, noCancel))
  );
  assert.deepEqual(
    results.map((r) => [r.version, r.license]),
    [
      ["1.0.0", "MIT"],
      ["1.1.0", "ISC"],
    ]
  );
  assert.notEqual(provider.cacheKey(provider.parse(a)[0]), provider.cacheKey(provider.parse(b)[0]));
  const deep = fakeDocument('[dependencies]\nreal="1"', "/" + "nested/".repeat(70) + "Cargo.toml");
  const unresolved = await provider.resolve(provider.parse(deep)[0], deep, noCancel);
  assert.equal(unresolved.source, "unknown");
  assert.match(unresolved.detail, /search limit/);
});

test("Cargo resolution integrates with Annotator Refresh and independent manifests", async (t) => {
  t.mock.method(stub.workspace.fs, "readFile", async () => {
    throw Object.assign(new Error("missing"), { code: "FileNotFound" });
  });
  t.mock.method(stub.workspace, "getConfiguration", () => ({
    get: (key, fallback) => (key === "crates.useRegistry" ? false : fallback),
  }));
  const cache = makeCache();
  t.after(() => cache.dispose());
  cache.set("crates:versions:v1:real", [{ version: "1.0.0", license: "MIT", yanked: false }]);
  const provider = new CratesLicenseProvider(cache);
  const editor = fakeEditor(
    fakeDocument('[dependencies]\na={package="real",version="1"}', "/project/Cargo.toml")
  );
  setVisibleEditors([editor]);
  const annotator = new Annotator([provider]);
  t.after(() => {
    annotator.dispose();
    setVisibleEditors([]);
  });
  annotator.refreshAll();
  await new Promise((r) => setTimeout(r, 350));
  assert.ok(editor.lastDecorations.some((d) => d.renderOptions.after.contentText.includes("MIT")));
  cache.clear();
  annotator.invalidate();
  annotator.refreshAll();
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(editor.lastDecorations.length, 0);
});

test("extension Refresh, Clear Cache and each Cargo setting invalidate the provider", async (t) => {
  const commands = new Map();
  const previous = stub.commands;
  stub.commands = {
    registerCommand(name, callback) {
      commands.set(name, callback);
      return { dispose() {} };
    },
  };
  const { activate } = require("../out/extension");
  t.after(() => {
    stub.commands = previous;
  });
  stub.window.showInformationMessage = async () => {};
  t.after(() => {
    delete stub.window.showInformationMessage;
  });
  let changed;
  t.mock.method(stub.workspace, "onDidChangeConfiguration", (callback) => {
    changed = callback;
    return { dispose() {} };
  });
  const invalidated = t.mock.method(CratesLicenseProvider.prototype, "invalidate");
  const cleared = t.mock.method(LicenseCache.prototype, "clear");
  const context = { globalState: { get() {}, async update() {} }, subscriptions: [] };
  setVisibleEditors([]);
  activate(context);
  t.after(() => context.subscriptions.forEach((s) => s.dispose()));
  commands.get("packageLicenseViewer.refresh")();
  await commands.get("packageLicenseViewer.clearCache")();
  assert.equal(cleared.mock.callCount(), 1);
  for (const key of ["enabled", "useRegistry", "useLockfiles"]) {
    const full = `packageLicenseViewer.crates.${key}`;
    changed({
      affectsConfiguration: (section) => full === section || full.startsWith(section + "."),
    });
  }
  assert.equal(invalidated.mock.callCount(), 5);
});

test(
  "the production-capable bundle parses Cargo and renders a cached license",
  {
    skip: !fs.existsSync(path.join(__dirname, "../dist/extension.js")),
  },
  async (t) => {
    const previous = stub.commands;
    stub.commands = {
      registerCommand() {
        return { dispose() {} };
      },
    };
    t.after(() => {
      stub.commands = previous;
    });
    t.mock.method(stub.workspace.fs, "readFile", async () => {
      throw Object.assign(new Error("missing"), { code: "FileNotFound" });
    });
    t.mock.method(stub.workspace, "getConfiguration", () => ({
      get: (key, fallback) => (key === "crates.useRegistry" ? false : fallback),
    }));
    const editor = fakeEditor(
      fakeDocument('[dependencies]\nalias={package="real",version="1"}', "/bundle/Cargo.toml")
    );
    setVisibleEditors([editor]);
    const context = {
      subscriptions: [],
      globalState: {
        get() {
          return {
            "crates:versions:v1:real": {
              t: Date.now(),
              v: [{ version: "1.0.0", license: "MIT", yanked: false }],
            },
          };
        },
        async update() {},
      },
    };
    t.after(() => {
      context.subscriptions.forEach((s) => s.dispose());
      setVisibleEditors([]);
    });
    require("../dist/extension.js").activate(context);
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.ok(
      editor.lastDecorations.some((d) => d.renderOptions.after.contentText.includes("MIT"))
    );
    assert.match(
      editor.lastDecorations.find((d) => d.hoverMessage)?.hoverMessage.value ?? "",
      /crates.io\/crates\/real\/1.0.0/
    );
  }
);

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
  assert.ok(parsed);
  assert.deepEqual(
    parsed.entries.map((e) => [e.name, e.line]),
    [
      ["a", 1],
      ["quoted-name", 2],
      ["b", 3],
      ["c", 4],
      ["d", 10],
      ["e", 12],
    ]
  );
  assert.equal(parsed.entries[1].declaration.name, "real");
  assert.equal(parsed.entries[4].section, "target.cfg(unix).build-dependencies");
});

test("Cargo inline sections and multiline strings use the start line", () => {
  const parsed = parseManifest('dependencies = { a = "1", b = { version = "2" } }\n', "a");
  assert.deepEqual(
    parsed.entries.map((e) => e.name),
    ["a", "b"]
  );
  assert.equal(parseManifest('[dependencies]\na = """1\n"""', "a").entries[0].line, 1);
  for (const text of ['[dependencies\na="1"', '[dependencies]\na="1"\na="2"'])
    assert.equal(parseManifest(text, "a"), undefined);
});

test("Cargo sources, inheritance and conflicts are explicit", () => {
  for (const source of ["path", "git", "registry", "registry-index"]) {
    assert.equal(dependencySpec("private", { version: "1", [source]: "secret" }).kind, "skipped");
  }
  assert.equal(dependencySpec("a", { workspace: true }).kind, "workspace");
  for (const value of [
    { workspace: false },
    { workspace: true, version: "1" },
    { package: 3, version: "1" },
    {},
  ])
    assert.equal(dependencySpec("a", value).kind, "unknown");
  const parsed = parseManifest(
    '[workspace]\n[patch.crates-io]\nalias={package="real",path="local"}\n[replace]\n"other:1.0.0"={path="other"}',
    "a"
  );
  assert.deepEqual(parsed.overrides, ["other", "real"]);
});

test("Cargo requirement semantics differ from npm and match Rust VersionReq", () => {
  const cases = [
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
    assert.equal(matchesRequirement(parseRequirement(req), v), expected, `${req}: ${v}`);
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
    assert.equal(parseRequirement(req).kind, "invalid", req);
  assert.equal(compareVersions("1.0.0-alpha.9", "1.0.0-alpha.10"), -1);
  assert.equal(compareVersions("1.0.0+a", "1.0.0+b"), 0);
});

test("an active Cargo update retries a cancelled shared lookup without a third event", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() + 1_000_000_000 });
  t.mock.method(stub.workspace.fs, "readFile", async () => {
    throw Object.assign(new Error("missing"), { code: "FileNotFound" });
  });
  let starts = 0,
    aborts = 0;
  t.mock.method(global, "fetch", async (_url, options) => {
    starts++;
    if (starts === 1)
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener("abort", () => {
          aborts++;
          reject(options.signal.reason);
        })
      );
    return { ok: true, json: async () => ({ versions: [apiVersion("1.0.0")] }) };
  });
  const cache = makeCache();
  const provider = new CratesLicenseProvider(cache);
  const document = fakeDocument('[dependencies]\nreal="1"', "/reupdate/Cargo.toml");
  const editor = fakeEditor(document);
  setVisibleEditors([editor]);
  const annotator = new Annotator([provider]);
  t.after(() => {
    annotator.dispose();
    cache.dispose();
    setVisibleEditors([]);
  });
  const first = annotator.update(document);
  await settle();
  assert.equal(starts, 1);
  const second = annotator.update(document);
  await settle();
  t.mock.timers.tick(1000);
  await settle();
  await Promise.all([first, second]);
  assert.equal(aborts, 1);
  assert.equal(starts, 2);
  assert.ok(editor.lastDecorations.some((d) => d.renderOptions.after.contentText.includes("MIT")));
});

test("explicit absolute Cargo workspace roots are not appended to the member directory", async (t) => {
  const requested = [];
  t.mock.method(stub.workspace.fs, "readFile", async (uri) => {
    requested.push(uri.path);
    if (uri.path === "/ws/Cargo.toml")
      return Buffer.from('[workspace]\n[workspace.dependencies]\nreal="1"');
    throw Object.assign(new Error("missing"), { code: "FileNotFound" });
  });
  const { CargoWorkspace } = require("../out/providers/crates/workspace");
  const document = fakeDocument('[package]\nworkspace="/ws"', "/app/Cargo.toml");
  const result = await new CargoWorkspace(vscodeFileSystem).root(
    stub.Uri.file("/app/Cargo.toml"),
    parseManifest(document.getText(), document.uri.toString())
  );
  assert.equal(result.kind, "found");
  assert.deepEqual(requested, ["/ws/Cargo.toml"]);
});

test("offline locked metadata reuses exact records from a fresh version list", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
  t.mock.method(stub.workspace, "getConfiguration", () => ({
    get: (key, fallback) => (key === "crates.useRegistry" ? false : fallback),
  }));
  const http = t.mock.method(global, "fetch", async () => {
    throw new Error("unexpected HTTP");
  });
  const cache = makeCache();
  t.after(() => cache.dispose());
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
    assert.deepEqual(result, { kind: "found", metadata });
    assert.equal(
      (await client.metadata("real", parseRequirement("1"), "1.0.1", noCancel)).kind,
      "unknown"
    );
  }
  t.mock.timers.tick(168 * 60 * 60 * 1000 + 1);
  assert.equal(
    (await client.metadata("real", parseRequirement("1"), "1.0.0", noCancel)).kind,
    "unknown"
  );
  assert.equal(http.mock.callCount(), 0);
});

test("Refresh during Cargo HTTP retries after the invalidated request settles", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() + 2_000_000_000 });
  t.mock.method(stub.workspace.fs, "readFile", async () => {
    throw Object.assign(new Error("missing"), { code: "FileNotFound" });
  });
  let starts = 0,
    aborts = 0;
  t.mock.method(global, "fetch", async (_url, options) => {
    starts++;
    if (starts === 1)
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          aborts++;
          reject(options.signal.reason);
        });
      });
    return { ok: true, json: async () => ({ versions: [apiVersion("1.0.0")] }) };
  });
  const cache = makeCache();
  const provider = new CratesLicenseProvider(cache);
  const document = fakeDocument('[dependencies]\nreal="1"', "/refresh/Cargo.toml");
  const editor = fakeEditor(document);
  setVisibleEditors([editor]);
  const annotator = new Annotator([provider]);
  t.after(() => {
    annotator.dispose();
    cache.dispose();
    setVisibleEditors([]);
  });
  const first = annotator.update(document);
  await settle();
  assert.equal(starts, 1);
  annotator.invalidate();
  annotator.refreshAll();
  await settle();
  await first;
  assert.equal(annotator.results.size, 0, "invalidated failure must not repopulate results");
  t.mock.timers.tick(25);
  await settle();
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(starts, 2);
  assert.equal(aborts, 1);
  assert.ok(editor.lastDecorations.some((d) => d.renderOptions.after.contentText.includes("MIT")));
});

test("root replace Package IDs exclude only the referenced crates.io name", async (t) => {
  t.mock.method(stub.workspace.fs, "readFile", async () => {
    throw Object.assign(new Error("missing"), { code: "FileNotFound" });
  });
  const cache = makeCache();
  t.after(() => cache.dispose());
  const calls = [];
  t.mock.method(CratesClient.prototype, "metadata", async (name) => {
    calls.push(name);
    return { kind: "found", metadata: { version: "1.0.0", license: "MIT", yanked: false } };
  });
  const http = t.mock.method(global, "fetch", async () => {
    throw new Error("unexpected HTTP");
  });
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
  ]) {
    calls.length = 0;
    const document = fakeDocument(
      `[workspace]\n[dependencies]\nalias={package="real",version="1"}\nunrelated="1"\n[replace]\n"${id}"={path="../private"}`,
      "/replace/Cargo.toml"
    );
    const provider = new CratesLicenseProvider(cache);
    const [entry, unrelated] = provider.parse(document);
    assert.equal(
      (await provider.resolve(entry, document, noCancel)).source,
      excluded ? "skipped" : "registry",
      id
    );
    assert.deepEqual(calls, excluded ? [] : ["real"], id);
    assert.equal((await provider.resolve(unrelated, document, noCancel)).source, "registry");
  }
  assert.equal(http.mock.callCount(), 0);
});

test("Windows UNC variants stop before any workspace file read", async (t) => {
  const { CargoWorkspace, workspaceManifestUri } = require("../out/providers/crates/workspace");
  const reads = t.mock.method(stub.workspace.fs, "readFile", async () =>
    Buffer.from("[workspace]")
  );
  for (const reference of [
    "//server/share/ws",
    "/\\server/share/ws",
    "\\/server/share/ws",
    "\\\\server\\share\\ws",
    "//?/C:/ws",
    "//./C:/ws",
  ]) {
    const directory = stub.Uri.file("/C:/app");
    assert.equal(workspaceManifestUri(directory, reference), undefined, reference);
    const document = fakeDocument(`[package]\nworkspace='${reference}'`, "/C:/app/Cargo.toml");
    const root = await new CargoWorkspace(vscodeFileSystem).root(
      stub.Uri.file("/C:/app/Cargo.toml"),
      parseManifest(document.getText(), document.uri.toString())
    );
    assert.equal(root.kind, "unknown", reference);
  }
  assert.equal(reads.mock.callCount(), 0);
  assert.equal(
    workspaceManifestUri(stub.Uri.file("/app"), "name\\part")?.path,
    "/app/name\\part/Cargo.toml"
  );
  assert.equal(workspaceManifestUri(stub.Uri.file("/app"), "/\\name")?.path, "/\\name/Cargo.toml");
});

test("root patches recognize trailing index slashes without suppressing other sources", async (t) => {
  t.mock.method(stub.workspace.fs, "readFile", async () => {
    throw Object.assign(new Error("missing"), { code: "FileNotFound" });
  });
  const cache = makeCache();
  t.after(() => cache.dispose());
  const calls = [];
  t.mock.method(CratesClient.prototype, "metadata", async (name) => {
    calls.push(name);
    return { kind: "unknown", reason: "mock lookup" };
  });
  for (const [source, excluded] of [
    ["crates-io", true],
    ["https://github.com/rust-lang/crates.io-index", true],
    ["https://github.com/rust-lang/crates.io-index/", true],
    ["https://private.example/index/", false],
    ["https://github.com/rust-lang/crates.io-index/other", false],
  ]) {
    calls.length = 0;
    const document = fakeDocument(
      `[workspace]\n[dependencies]\nreal="1"\nother="1"\n[patch."${source}"]\nalias={package="real",path="local"}`,
      "/patch/Cargo.toml"
    );
    const provider = new CratesLicenseProvider(cache);
    const [entry, other] = provider.parse(document);
    assert.equal(
      (await provider.resolve(entry, document, noCancel)).source,
      excluded ? "skipped" : "unknown",
      source
    );
    assert.deepEqual(calls, excluded ? [] : ["real"]);
    await provider.resolve(other, document, noCancel);
    assert.equal(calls.at(-1), "other");
  }
});

test("range cache reuse preserves the original metadata expiry online and offline", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
  let online = false;
  t.mock.method(stub.workspace, "getConfiguration", () => ({
    get: (key, fallback) => (key === "crates.useRegistry" ? online : fallback),
  }));
  const http = t.mock.method(global, "fetch", async () => {
    throw new Error("unexpected HTTP");
  });
  const cache = makeCache();
  t.after(() => cache.dispose());
  const client = new CratesClient(cache);
  const metadata = { version: "1.0.0", license: "MIT", yanked: false };
  for (const seedExact of [false, true]) {
    cache.clear();
    cache.set("crates:versions:v1:real", [metadata]);
    if (seedExact) cache.set("crates:metadata:v1:real@1.0.0", metadata);
    t.mock.timers.tick(167 * 3600000);
    for (online of [false, true]) {
      assert.equal(
        (await client.metadata("real", parseRequirement("1"), undefined, noCancel)).kind,
        "found"
      );
    }
    online = false;
    assert.equal(
      (await client.metadata("real", parseRequirement("1"), "1.0.0", noCancel)).kind,
      "found"
    );
    t.mock.timers.tick(2 * 3600000);
    assert.equal(
      (await client.metadata("real", parseRequirement("1"), "1.0.0", noCancel)).kind,
      "unknown"
    );
  }
  assert.equal(http.mock.callCount(), 0);
});
