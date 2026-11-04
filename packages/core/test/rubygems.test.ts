import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { LicenseCache } from "../src/cache";
import type { ViewerConfig } from "../src/config";
import { buildHover, formatAnnotation } from "../src/format";
import { RubyGemsLicenseProvider } from "../src/providers/rubygems";
import { combineLicenses } from "../src/providers/rubygems/client";
import { parseLock, selectLocked } from "../src/providers/rubygems/lockfile";
import { parseGemfile, parseGemspec } from "../src/providers/rubygems/parse";
import {
  compareVersions,
  matchesRequirement,
  parseRequirement,
  validVersion,
} from "../src/providers/rubygems/spec";
import { fakeDocument, fakeHost } from "./support/fakeHost";
import { setSettings } from "./support/vscodeStub";

const noCancel = {
  isCancellationRequested: false,
  onCancellationRequested: (_listener: (e: unknown) => unknown) => ({ dispose() {} }),
};
const makeCache = () => new LicenseCache({ get() {}, keys: () => [], async update() {} });

afterEach(() => {
  setSettings({});
  vi.restoreAllMocks();
});

// --- versions and requirements ------------------------------------------------

test("RubyGems versions compare the way Gem::Version does", () => {
  expect(validVersion("1.0")).toBe(true);
  expect(validVersion("4.1.0.beta3")).toBe(true);
  expect(validVersion("1.0-")).toBe(false);
  expect(validVersion("v1.0")).toBe(false);
  expect(validVersion("")).toBe(false);
  // Zero padding makes these equal
  expect(compareVersions("1.0", "1.0.0")).toBe(0);
  expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
  expect(compareVersions("2.6.10", "2.6.9")).toBeGreaterThan(0);
  // A letter segment sorts before the release it precedes
  expect(compareVersions("1.0.0.beta", "1.0.0")).toBeLessThan(0);
  expect(compareVersions("1.0.0.beta2", "1.0.0.beta10")).toBeLessThan(0);
  expect(compareVersions("1.0.0.beta", "1.0.0.beta.1")).toBeLessThan(0);
  expect(compareVersions("1.0.0.1", "1.0.0.beta")).toBeGreaterThan(0);
});

test("requirements AND their comparators, with the pessimistic operator", () => {
  const req = (inputs: string[]) => parseRequirement(inputs);
  expect(matchesRequirement(req([]), "9.9.9")).toBe(true);
  // …but the default >= 0 still does not admit a prerelease
  expect(matchesRequirement(req([]), "9.9.9.beta")).toBe(false);
  expect(matchesRequirement(req(["~> 2.2"]), "2.9.9")).toBe(true);
  expect(matchesRequirement(req(["~> 2.2"]), "3.0")).toBe(false);
  expect(matchesRequirement(req(["~> 2.2.0"]), "2.2.9")).toBe(true);
  expect(matchesRequirement(req(["~> 2.2.0"]), "2.3")).toBe(false);
  expect(matchesRequirement(req(["~> 2"]), "2.99")).toBe(true);
  expect(matchesRequirement(req(["~> 2"]), "3")).toBe(false);
  // Several strings, and commas inside one string, are all ANDed
  expect(matchesRequirement(req([">= 1.5", "< 2.0"]), "1.9")).toBe(true);
  expect(matchesRequirement(req([">= 1.5, < 2.0"]), "2.0")).toBe(false);
  expect(matchesRequirement(req(["= 1.0"]), "1.0.0")).toBe(true);
  expect(matchesRequirement(req(["!= 1.0"]), "1.0.0")).toBe(false);
  expect(matchesRequirement(req(["1.2.3"]), "1.2.3")).toBe(true);
  expect(matchesRequirement(req(["1.2.3"]), "1.2.4")).toBe(false);
  // A prerelease needs the requirement itself to name one
  expect(matchesRequirement(req([">= 1.0"]), "1.1.beta")).toBe(false);
  expect(matchesRequirement(req([">= 1.1.beta"]), "1.1.beta")).toBe(true);
  expect(matchesRequirement(req(["~> 1.1.beta"]), "1.1.beta2")).toBe(true);
  expect(parseRequirement([">= foo"]).kind).toBe("invalid");
  expect(parseRequirement(["=> 1.0"]).kind).toBe("invalid");
  expect(parseRequirement(["1..2"]).kind).toBe("invalid");
});

// --- Gemfile parsing ------------------------------------------------------------

const GEMFILE = [
  "# frozen_string_literal: true",
  "",
  'source "https://rubygems.org"',
  "",
  'ruby "3.3.0"',
  "",
  'gem "rails", "~> 8.0"',
  'gem "pg", ">= 1.5", "< 2.0" # a trailing comment',
  "gem 'puma'",
  'gem("rake", "13.2.1")',
  "",
  "group :development, :test do",
  '  gem "rspec", "~> 3.13"',
  "end",
  "",
  'gem "sidekiq", git: "https://github.com/sidekiq/sidekiq.git", branch: "main"',
  'gem "local_lib", path: "../local_lib"',
  'gem "hash_rocket", :git => "https://example.com/x.git"',
  'gem "multi",',
  '    "~> 1.0",',
  "    require: false",
  "",
  'source "https://gems.example.com" do',
  '  gem "private_gem", "1.0"',
  "end",
  "",
  "gemspec",
].join("\n");

test("Gemfile gem calls are read, with sources and options understood", () => {
  const entries = parseGemfile(GEMFILE, "file:///project/Gemfile");
  expect(entries.map((entry) => [entry.name, entry.spec, entry.line])).toEqual([
    ["rails", "~> 8.0", 6],
    ["pg", ">= 1.5, < 2.0", 7],
    ["puma", "", 8],
    ["rake", "13.2.1", 9],
    ["rspec", "~> 3.13", 12],
    ["sidekiq", "", 15],
    ["local_lib", "", 16],
    ["hash_rocket", "", 17],
    ["multi", "~> 1.0", 18],
    ["private_gem", "", 23],
  ]);
  expect(entries.map((entry) => entry.declaration)).toEqual([
    { kind: "rubygems", name: "rails", requirements: ["~> 8.0"] },
    { kind: "rubygems", name: "pg", requirements: [">= 1.5", "< 2.0"] },
    { kind: "rubygems", name: "puma", requirements: [] },
    { kind: "rubygems", name: "rake", requirements: ["13.2.1"] },
    { kind: "rubygems", name: "rspec", requirements: ["~> 3.13"] },
    { kind: "skipped", reason: "git and path gems are not published to RubyGems" },
    { kind: "skipped", reason: "git and path gems are not published to RubyGems" },
    { kind: "skipped", reason: "git and path gems are not published to RubyGems" },
    { kind: "rubygems", name: "multi", requirements: ["~> 1.0"] },
    { kind: "skipped", reason: "declared with a non-default source" },
  ]);
  expect(entries.every((entry) => entry.section === "Gemfile")).toBe(true);
});

test("a half-typed or computed Gemfile line never blanks out its neighbours", () => {
  const text = [
    'gem "before", "1.0"',
    'gem "computed_#{flavour}", "1.0"',
    "gem variable_name",
    'gem "after"',
  ].join("\n");
  const entries = parseGemfile(text, "file:///project/Gemfile");
  expect(entries.map((entry) => [entry.name, entry.declaration.kind])).toEqual([
    ["before", "rubygems"],
    ["computed_", "unknown"],
    ["after", "rubygems"],
  ]);
});

test("a per-gem source option skips, and a %i[…] option value does not disturb the call", () => {
  const text = [
    'gem "per_gem_source", "1.0", source: "https://gems.example.com"',
    "gem 'tzinfo-data', platforms: %i[windows jruby]",
  ].join("\n");
  const entries = parseGemfile(text, "file:///project/Gemfile");
  expect(entries.map((entry) => entry.declaration)).toEqual([
    { kind: "skipped", reason: "declared with a non-default source" },
    { kind: "rubygems", name: "tzinfo-data", requirements: [] },
  ]);
});

// --- gemspec parsing ------------------------------------------------------------

test("gemspec dependency calls are read, heredoc prose is not", () => {
  const text = [
    'require_relative "lib/foo/version"',
    "",
    "Gem::Specification.new do |spec|",
    '  spec.name = "foo"',
    "  spec.version = Foo::VERSION",
    "  spec.description = <<~DESC",
    "    A gem that does things.",
    '    spec.add_dependency "not_real", "9.9"',
    "  DESC",
    "",
    '  spec.add_dependency "rake", "~> 13.0"',
    '  spec.add_dependency "thor", ">= 1.0"',
    '  spec.add_runtime_dependency "bundler"',
    '  spec.add_development_dependency "rspec", "~> 3.12"',
    "end",
  ].join("\n");
  const entries = parseGemspec(text, "file:///project/foo.gemspec");
  expect(entries.map((entry) => [entry.name, entry.spec, entry.section, entry.line])).toEqual([
    ["rake", "~> 13.0", "dependencies", 10],
    ["thor", ">= 1.0", "dependencies", 11],
    ["bundler", "", "dependencies", 12],
    ["rspec", "~> 3.12", "development dependencies", 13],
  ]);
});

test("a gemspec requirement written as an expression is unknown, not read as >= 0", () => {
  const text = [
    "Gem::Specification.new do |spec|",
    '  spec.add_dependency "computed", Gem::Requirement.new(">= 1.0")',
    '  spec.add_dependency "plain", ">= 1.0"',
    "end",
  ].join("\n");
  const entries = parseGemspec(text, "file:///project/foo.gemspec");
  expect(entries.map((entry) => [entry.name, entry.declaration.kind])).toEqual([
    ["computed", "unknown"],
    ["plain", "rubygems"],
  ]);
});

// --- Gemfile.lock -----------------------------------------------------------------

const LOCK = [
  "GIT",
  "  remote: https://github.com/example/git_gem.git",
  "  revision: 0123456789abcdef",
  "  specs:",
  "    git_gem (1.0.0)",
  "",
  "GEM",
  "  remote: https://rubygems.org/",
  "  specs:",
  "    rails (8.0.1)",
  "      railties (= 8.0.1)",
  "    nokogiri (1.16.2-x64-mingw32)",
  "      racc (~> 1.4)",
  "    nokogiri (1.16.2-x86_64-linux)",
  "      racc (~> 1.4)",
  "    racc (1.8.1)",
  "",
  "GEM",
  "  remote: https://gems.example.com/",
  "  specs:",
  "    private_gem (1.0.0)",
  "",
  "PLATFORMS",
  "  ruby",
  "",
  "DEPENDENCIES",
  "  rails (~> 8.0)",
].join("\n");

test("Gemfile.lock public specs are indexed, platforms stripped, other sources ignored", () => {
  const parsed = parseLock(LOCK);
  expect(parsed.get("rails")).toEqual(["8.0.1"]);
  expect(parsed.get("nokogiri")).toEqual(["1.16.2", "1.16.2"]);
  expect(parsed.get("git_gem")).toBeUndefined();
  expect(parsed.get("private_gem")).toBeUndefined();
  // The six-space lines under a spec are its dependencies, not entries
  expect(parsed.get("railties")).toBeUndefined();
  expect(parsed.get("racc")).toEqual(["1.8.1"]);

  expect(selectLocked(LOCK, "rails", parseRequirement(["~> 8.0"]))).toEqual({
    kind: "selected",
    version: "8.0.1",
  });
  expect(selectLocked(LOCK, "rails", parseRequirement(["~> 7.0"])).kind).toBe("fallback");
  expect(selectLocked(LOCK, "missing", parseRequirement([])).kind).toBe("fallback");
});

test("gem.coop locks count as public, and a locked prerelease named by the requirement is selected", () => {
  const coop = ["GEM", "  remote: https://gem.coop/", "  specs:", "    rake (13.2.1)"].join("\n");
  expect(selectLocked(coop, "rake", parseRequirement(["~> 13.0"]))).toEqual({
    kind: "selected",
    version: "13.2.1",
  });
  const beta = [
    "GEM",
    "  remote: https://rubygems.org/",
    "  specs:",
    "    beta_gem (2.0.0.beta1)",
  ].join("\n");
  expect(selectLocked(beta, "beta_gem", parseRequirement([">= 2.0.0.beta1"]))).toEqual({
    kind: "selected",
    version: "2.0.0.beta1",
  });
});

test("combineLicenses joins what a release declares", () => {
  expect(combineLicenses(undefined)).toBeUndefined();
  expect(combineLicenses([])).toBeUndefined();
  expect(combineLicenses(["MIT"])).toBe("MIT");
  expect(combineLicenses(["MIT", "MIT", " Apache-2.0 "])).toBe("MIT AND Apache-2.0");
  expect(combineLicenses(["MIT OR Apache-2.0", "BSD-3-Clause"])).toBe(
    "(MIT OR Apache-2.0) AND BSD-3-Clause"
  );
});

// --- provider ---------------------------------------------------------------------

function versionsResponse(records: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => records,
  } as Response;
}

function versionRecord(
  number: string,
  licenses: string[] | null,
  extra: Record<string, unknown> = {}
) {
  return {
    number,
    licenses,
    prerelease: number.includes("beta") || number.includes("rc"),
    platform: "ruby",
    ...extra,
  };
}

test("provider resolves from the requirement, prefers RubyGems pages, and caches the list", async () => {
  const calls: string[] = [];
  vi.spyOn(global, "fetch").mockImplementation((async (url: string) => {
    calls.push(url);
    return versionsResponse([
      versionRecord("8.1.0.beta1", ["MIT"]),
      versionRecord("8.0.1", ["MIT"], {
        metadata: { homepage_uri: "https://rubyonrails.org" },
      }),
      versionRecord("7.2.0", ["MIT"]),
    ]);
  }) as typeof fetch);
  const cache = makeCache();
  onTestFinished(() => cache.dispose());
  const provider = new RubyGemsLicenseProvider(cache, fakeHost());
  const doc = fakeDocument('gem "rails", "~> 8.0"', "/project/Gemfile");
  const entry = provider.parse(doc)[0];
  const info = await provider.resolve(entry, doc, noCancel);
  expect(info).toMatchObject({
    source: "registry",
    license: "MIT",
    version: "8.0.1",
    homepage: "https://rubyonrails.org",
    via: "manifest requirement + RubyGems",
  });
  expect(buildHover(entry, info)?.value).toMatch(
    /https:\/\/rubygems\.org\/gems\/rails\/versions\/8\.0\.1/
  );
  // A second resolve of the same gem is served from the cached version list
  const again = await provider.resolve(entry, doc, noCancel);
  expect(again.version).toBe("8.0.1");
  expect(calls).toHaveLength(1);
  expect(calls[0]).toBe("https://rubygems.org/api/v1/versions/rails.json");
});

const FORMAT_CONFIG: ViewerConfig = {
  enabled: true,
  format: "${license}",
  showResolvedVersion: false,
  showNodeEngine: true,
  showRubyVersion: true,
  unknownText: "",
  annotationColor: "editorCodeLens.foreground",
  licenseColor: "charts.green",
  margin: "0 0 0 1.5em",
  cacheTtlHours: 168,
  requestTimeoutMs: 8000,
  maxConcurrentRequests: 8,
};

test("a release's required_ruby_version is appended like Node's engines range; \">= 0\" means none", async () => {
  vi.spyOn(global, "fetch").mockImplementation((async (url: string) => {
    if (url.includes("/versions/needs_ruby.json")) {
      return versionsResponse([versionRecord("2.0.0", ["MIT"], { ruby_version: ">= 3.0" })]);
    }
    return versionsResponse([versionRecord("1.0.0", ["MIT"], { ruby_version: ">= 0" })]);
  }) as typeof fetch);
  const cache = makeCache();
  onTestFinished(() => cache.dispose());
  const provider = new RubyGemsLicenseProvider(cache, fakeHost());
  const doc = fakeDocument('gem "needs_ruby"\ngem "any_ruby"', "/project/Gemfile");
  const entries = provider.parse(doc);
  const needs = await provider.resolve(entries[0], doc, noCancel);
  expect(needs.rubyVersion).toBe(">= 3.0");
  expect(formatAnnotation(FORMAT_CONFIG, entries[0], needs)).toBe("MIT (Ruby: >= 3.0)");
  expect(formatAnnotation({ ...FORMAT_CONFIG, showRubyVersion: false }, entries[0], needs)).toBe(
    "MIT"
  );
  expect(buildHover(entries[0], needs)?.value).toContain("Ruby: `>= 3.0`");
  const any = await provider.resolve(entries[1], doc, noCancel);
  expect(any.rubyVersion).toBeUndefined();
  expect(formatAnnotation(FORMAT_CONFIG, entries[1], any)).toBe("MIT");
});

test("platform builds of one release collapse, preferring the ruby platform record", async () => {
  vi.spyOn(global, "fetch").mockImplementation((async () =>
    versionsResponse([
      versionRecord("1.0.0", ["BSD-3-Clause"], { platform: "x64-mingw32" }),
      versionRecord("1.0.0", ["MIT"], { platform: "ruby" }),
      versionRecord("1.0.0", ["BSD-3-Clause"], { platform: "java" }),
    ])) as typeof fetch);
  const cache = makeCache();
  onTestFinished(() => cache.dispose());
  const provider = new RubyGemsLicenseProvider(cache, fakeHost());
  const doc = fakeDocument('gem "multi_platform", "1.0"', "/project/Gemfile");
  const info = await provider.resolve(provider.parse(doc)[0], doc, noCancel);
  expect(info.version).toBe("1.0.0");
  expect(info.license).toBe("MIT");
});

test("provider uses a uniquely matching Gemfile.lock version, even a yanked-era one", async () => {
  vi.spyOn(global, "fetch").mockImplementation((async () =>
    versionsResponse([
      versionRecord("8.0.1", ["MIT"]),
      versionRecord("8.0.0", ["MIT"]),
    ])) as typeof fetch);
  const cache = makeCache();
  onTestFinished(() => cache.dispose());
  const files = new Map<string, string>([["/project/Gemfile.lock", LOCK]]);
  const provider = new RubyGemsLicenseProvider(cache, fakeHost(files));
  const doc = fakeDocument('gem "rails", "~> 8.0"', "/project/Gemfile");
  const info = await provider.resolve(provider.parse(doc)[0], doc, noCancel);
  expect(info.version).toBe("8.0.1");
  expect(info.via).toBe("Gemfile.lock + RubyGems");
});

test("skipped declarations never reach the network, and failures stay unknown", async () => {
  const calls: string[] = [];
  vi.spyOn(global, "fetch").mockImplementation((async (url: string) => {
    calls.push(url);
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as typeof fetch);
  const cache = makeCache();
  onTestFinished(() => cache.dispose());
  const provider = new RubyGemsLicenseProvider(cache, fakeHost());
  const gitDoc = fakeDocument('gem "x", git: "https://example.com/x.git"', "/project/Gemfile");
  expect(await provider.resolve(provider.parse(gitDoc)[0], gitDoc, noCancel)).toEqual({
    source: "skipped",
    detail: "git and path gems are not published to RubyGems",
  });
  expect(calls).toHaveLength(0);

  const missingDoc = fakeDocument('gem "no_such_gem_xyz", "1.0"', "/project/Gemfile");
  const missing = await provider.resolve(provider.parse(missingDoc)[0], missingDoc, noCancel);
  expect(missing.source).toBe("unknown");
  expect(missing.detail).toMatch(/RubyGems lookup failed/);
});

test("with the registry disabled, only cached metadata answers", async () => {
  setSettings({ "packageLicenseViewer.rubygems.useRegistry": false });
  const cache = makeCache();
  onTestFinished(() => cache.dispose());
  const provider = new RubyGemsLicenseProvider(cache, fakeHost());
  const doc = fakeDocument('gem "rails", "~> 8.0"', "/project/Gemfile");
  const entry = provider.parse(doc)[0];
  const offline = await provider.resolve(entry, doc, noCancel);
  expect(offline.source).toBe("unknown");
  expect(offline.detail).toMatch(/registry disabled/);

  cache.set("rubygems:versions:v1:rails", [
    { version: "8.0.1", licenses: ["MIT"], prerelease: false, platform: "ruby" },
  ]);
  const cached = await provider.resolve(entry, doc, noCancel);
  expect(cached.license).toBe("MIT");
  expect(cached.version).toBe("8.0.1");
});

test("supports recognizes Gemfiles and gemspecs, and cache keys keep manifests apart", () => {
  const provider = new RubyGemsLicenseProvider(makeCache(), fakeHost());
  expect(provider.supports(fakeDocument("", "/project/Gemfile"))).toBe(true);
  expect(provider.supports(fakeDocument("", "/project/foo.gemspec"))).toBe(true);
  expect(provider.supports(fakeDocument("", "/project/Gemfile.lock"))).toBe(false);
  expect(provider.supports(fakeDocument("", "/project/package.json"))).toBe(false);
  const a = provider.parse(fakeDocument('gem "rails", "~> 8.0"', "/a/Gemfile"))[0];
  const b = provider.parse(fakeDocument('gem "rails", "~> 8.0"', "/b/Gemfile"))[0];
  expect(provider.cacheKey(a)).not.toBe(provider.cacheKey(b));
});
