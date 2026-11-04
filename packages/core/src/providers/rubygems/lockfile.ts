import { matchesRequirement, validVersion, type Requirement } from "./spec";

export type LockSelection = { kind: "selected"; version: string } | { kind: "fallback" };

/**
 * Gemfile.lock parsed once and indexed by gem name, so a manifest with many
 * dependencies does not re-parse the whole (transitive-dependency-including)
 * file for every single one of them.
 */
export type ParsedLock = ReadonlyMap<string, readonly string[]>;

/**
 * Public sources whose gems are the ones published on rubygems.org. Bundler 4
 * writes gem.coop as its default source; it mirrors the same package set.
 */
const PUBLIC_REMOTES = new Set(["https://rubygems.org/", "https://gem.coop/"]);

/**
 * Parse a Gemfile.lock. Only the `GEM` sections served by a public source are
 * indexed: `GIT` and `PATH` sections hold gems RubyGems never published, and a
 * `GEM` section pointing at a private server may carry names that collide
 * with public ones. Inside `specs:`, a gem is the four-space-indented
 * `name (version)` line; the six-space lines under it are its own
 * dependencies and are not entries.
 */
export function parseLock(text: string): ParsedLock {
  const byName = new Map<string, string[]>();
  let section: string | undefined;
  let gemSectionPublic = false;
  let inSpecs = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (/^[A-Z]/.test(line)) {
      section = line.trim();
      gemSectionPublic = false;
      inSpecs = false;
      continue;
    }
    if (section !== "GEM") continue;
    const remote = /^ {2}remote: (\S+)$/.exec(line);
    if (remote) {
      if (PUBLIC_REMOTES.has(remote[1])) gemSectionPublic = true;
      continue;
    }
    if (line === "  specs:") {
      inSpecs = gemSectionPublic;
      continue;
    }
    if (!inSpecs) continue;
    const spec = /^ {4}([A-Za-z0-9._-]+) \(([^)]+)\)/.exec(line);
    if (!spec) continue;
    const version = versionOf(spec[2]);
    if (!version) continue;
    const versions = byName.get(spec[1]);
    if (versions) versions.push(version);
    else byName.set(spec[1], [version]);
  }
  return byName;
}

/**
 * The version inside a lockfile entry's parentheses. An entry for a platform
 * build appends `-<platform>` (`1.16.2-x64-mingw32`); strip trailing platform
 * parts until what remains is a version. (A RubyGems version itself never
 * contains a `-`.)
 */
function versionOf(text: string): string | undefined {
  let candidate = text.trim();
  while (candidate && !validVersion(candidate)) {
    const dash = candidate.lastIndexOf("-");
    if (dash === -1) return undefined;
    candidate = candidate.slice(0, dash);
  }
  return candidate || undefined;
}

/** A unique matching public version is useful evidence, not a reconstruction of dependency edges. */
export function selectFromParsed(
  parsed: ParsedLock,
  name: string,
  requirement: Requirement
): LockSelection {
  const versions = new Set(
    parsed.get(name)?.filter((version) => matchesRequirement(requirement, version)) ?? []
  );
  return versions.size === 1
    ? { kind: "selected", version: [...versions][0] }
    : { kind: "fallback" };
}

/** Convenience wrapper for a one-off lookup; prefer `parseLock` + `selectFromParsed` when checking more than one name against the same Gemfile.lock. */
export function selectLocked(text: string, name: string, requirement: Requirement): LockSelection {
  return selectFromParsed(parseLock(text), name, requirement);
}
