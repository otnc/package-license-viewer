import { getStaticTOMLValue, parseTOML } from "toml-eslint-parser";
import { record } from "./parse";
import { matchesRequirement, type Requirement } from "./spec";

export type LockSelection = { kind: "selected"; version: string } | { kind: "fallback" };
const CRATES_SOURCE = "registry+https://github.com/rust-lang/crates.io-index";

/**
 * Cargo.lock parsed once and indexed by package name, so a manifest with many dependencies does
 * not re-parse the whole (potentially large, transitive-dependency-including) file from scratch
 * for every single one of them. `undefined` means the document is not a Cargo.lock this provider
 * understands at all (wrong shape, unsupported `version`, or invalid TOML) — every name misses.
 */
export type ParsedLock = ReadonlyMap<string, readonly string[]> | undefined;

/** Parse a Cargo.lock once. Only crates.io-sourced packages are indexed; nothing else can be selected. */
export function parseLock(text: string): ParsedLock {
  try {
    const data: unknown = getStaticTOMLValue(parseTOML(text, { tomlVersion: "1.0" }));
    if (
      !record(data) ||
      !Array.isArray(data.package) ||
      (data.version !== undefined &&
        data.version !== 1 &&
        data.version !== 2 &&
        data.version !== 3 &&
        data.version !== 4)
    )
      return undefined;
    const byName = new Map<string, string[]>();
    for (const pkg of data.package) {
      if (
        record(pkg) &&
        typeof pkg.name === "string" &&
        pkg.source === CRATES_SOURCE &&
        typeof pkg.version === "string"
      ) {
        const versions = byName.get(pkg.name);
        if (versions) versions.push(pkg.version);
        else byName.set(pkg.name, [pkg.version]);
      }
    }
    return byName;
  } catch {
    return undefined;
  }
}

/** A unique matching public version is useful evidence, not a reconstruction of dependency edges. */
export function selectFromParsed(
  parsed: ParsedLock,
  name: string,
  requirement: Requirement
): LockSelection {
  const versions = new Set(
    (parsed?.get(name) ?? []).filter((version) => matchesRequirement(requirement, version))
  );
  return versions.size === 1
    ? { kind: "selected", version: [...versions][0] }
    : { kind: "fallback" };
}

/** Convenience wrapper for a one-off lookup; prefer `parseLock` + `selectFromParsed` when checking more than one name against the same Cargo.lock. */
export function selectLocked(text: string, name: string, requirement: Requirement): LockSelection {
  return selectFromParsed(parseLock(text), name, requirement);
}
