import { getStaticTOMLValue, parseTOML } from "toml-eslint-parser";
import { record } from "./parse";
import { matchesRequirement, type Requirement } from "./spec";

export type LockSelection = { kind: "selected"; version: string } | { kind: "fallback" };
const CRATES_SOURCE = "registry+https://github.com/rust-lang/crates.io-index";

/** A unique matching public version is useful evidence, not a reconstruction of dependency edges. */
export function selectLocked(text: string, name: string, requirement: Requirement): LockSelection {
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
      return { kind: "fallback" };
    const versions = new Set<string>();
    for (const pkg of data.package) {
      if (
        record(pkg) &&
        pkg.name === name &&
        pkg.source === CRATES_SOURCE &&
        typeof pkg.version === "string" &&
        matchesRequirement(requirement, pkg.version)
      )
        versions.add(pkg.version);
    }
    return versions.size === 1
      ? { kind: "selected", version: [...versions][0] }
      : { kind: "fallback" };
  } catch {
    return { kind: "fallback" };
  }
}
