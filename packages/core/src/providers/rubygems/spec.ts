/**
 * RubyGems versions and requirements, interpreted the way `Gem::Version` and
 * `Gem::Requirement` do — independently of npm ranges and of Cargo requirements.
 *
 * A version is dot-separated alphanumeric parts starting with a digit (`1.0`,
 * `4.1.0.beta3`, `2.6.10`). Each part breaks into runs of digits and letters
 * (`beta3` → `"beta"`, `3`), and a version with any letter run is a prerelease.
 * Comparison pads the shorter version with zero segments; a letter segment
 * always sorts before a numeric one, which is what makes `1.0.0.beta` sort
 * before `1.0.0`.
 *
 * A requirement is a set of `operator version` comparators — `=`, `!=`, `>`,
 * `<`, `>=`, `<=` and the pessimistic `~>` — and every comparator must hold.
 * `~> 2.2` means `>= 2.2` and `< 3`; `~> 2.2.0` means `>= 2.2.0` and `< 2.3`:
 * the upper bound drops the last release segment and increments what remains.
 */

type Segment = number | string;

const VERSION_PATTERN = /^[0-9]+(?:\.[0-9A-Za-z]+)*$/;

export function validVersion(value: string): boolean {
  return VERSION_PATTERN.test(value);
}

/** A version is a prerelease when any segment is a letter run (`beta`, `rc`, …) */
export function isPrerelease(value: string): boolean {
  return segmentsOf(value).some((segment) => typeof segment === "string");
}

function segmentsOf(value: string): Segment[] {
  const segments: Segment[] = [];
  for (const run of value.match(/[0-9]+|[A-Za-z]+/g) ?? []) {
    segments.push(/^[0-9]+$/.test(run) ? Number(run) : run.toLowerCase());
  }
  return segments;
}

/** The release part of a version: the numeric segments before the first letter run */
function releaseSegments(value: string): number[] {
  const release: number[] = [];
  for (const segment of segmentsOf(value)) {
    if (typeof segment !== "number") break;
    release.push(segment);
  }
  return release;
}

export function compareVersions(a: string, b: string): number {
  const left = segmentsOf(a);
  const right = segmentsOf(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const x = left[index] ?? 0;
    const y = right[index] ?? 0;
    if (x === y) continue;
    // A letter segment sorts before a number, so a prerelease precedes its release
    if (typeof x === "string" && typeof y === "number") return -1;
    if (typeof x === "number" && typeof y === "string") return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** The exclusive upper bound of a `~>` comparator, the way `Gem::Version#bump` computes it */
function pessimisticUpperBound(value: string): string {
  const segments = segmentsOf(value);
  while (segments.length > 0 && typeof segments[segments.length - 1] === "string") {
    segments.pop();
  }
  if (segments.length > 1) segments.pop();
  if (segments.length === 0) return "0";
  segments[segments.length - 1] = (segments[segments.length - 1] as number) + 1;
  return segments.join(".");
}

/** The version with its prerelease part dropped, the way `Gem::Version#release` computes it */
function releaseOf(value: string): string {
  return releaseSegments(value).join(".");
}

export interface Comparator {
  readonly op: string;
  readonly version: string;
}

export type Requirement = { kind: "valid"; comparators: Comparator[] } | { kind: "invalid" };

const COMPARATOR_PATTERN = /^(>=|<=|!=|~>|==|=|>|<)?\s*(\S+)$/;

/**
 * Parse the version requirement strings of one declaration. A `gem` call takes
 * several strings and each string may itself hold comma-separated comparators;
 * all of them are ANDed. No strings at all is RubyGems' default, `>= 0`.
 */
export function parseRequirement(inputs: readonly string[]): Requirement {
  const comparators: Comparator[] = [];
  for (const input of inputs) {
    for (const fragment of input.split(",")) {
      const match = COMPARATOR_PATTERN.exec(fragment.trim());
      if (!match) return { kind: "invalid" };
      const version = match[2];
      if (!validVersion(version)) return { kind: "invalid" };
      comparators.push({ op: match[1] === "==" ? "=" : (match[1] ?? "="), version });
      if (comparators.length > 32) return { kind: "invalid" };
    }
  }
  if (comparators.length === 0) comparators.push({ op: ">=", version: "0" });
  return { kind: "valid", comparators };
}

export function matchesRequirement(req: Requirement, value: string): boolean {
  if (req.kind === "invalid" || !validVersion(value)) return false;
  // A prerelease version only counts when the requirement itself names a
  // prerelease — the rule Bundler applies when it picks candidates.
  if (
    isPrerelease(value) &&
    !req.comparators.some((comparator) => isPrerelease(comparator.version))
  ) {
    return false;
  }
  return req.comparators.every((comparator) => {
    const order = compareVersions(value, comparator.version);
    switch (comparator.op) {
      case "=":
        return order === 0;
      case "!=":
        return order !== 0;
      case ">":
        return order > 0;
      case "<":
        return order < 0;
      case ">=":
        return order >= 0;
      case "<=":
        return order <= 0;
      case "~>":
        return (
          order >= 0 &&
          compareVersions(releaseOf(value), pessimisticUpperBound(comparator.version)) < 0
        );
      default:
        return false;
    }
  });
}
