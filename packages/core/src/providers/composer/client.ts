import type { LicenseCache } from "../../cache";
import { getSetting } from "../../config";
import { checkCancelled, fetchJson, NotFoundError, record } from "../../net";
import type { CancellationLike } from "../types";
import { decodePackageRecord, type PackageRecord } from "./metadata";
import {
  compareStability,
  compareVersions,
  parseStability,
  satisfies,
  type Stability,
  type ValidConstraint,
} from "./spec";

export const PACKAGIST_P2 = "https://repo.packagist.org/p2";

/** How long every client stops sending after Packagist answers HTTP 429 */
const STAND_DOWN_MS = 60_000;

export type VersionsResult =
  { kind: "found"; versions: readonly PackageRecord[] } | { kind: "unknown"; reason: string };

/**
 * The shared pause after an HTTP 429. Packagist publishes no rate limit and its p2 files are
 * static CDN-served JSON, so requests go out in parallel under the annotator's limit with no
 * spacing — but a 429 from anywhere stops every client for a minute, with no automatic retry.
 * The clock is injectable so tests can move time without touching real timers.
 */
export class StandDown {
  private until = 0;

  constructor(private readonly now: () => number = Date.now) {}

  active(): boolean {
    return this.now() < this.until;
  }

  trigger(): void {
    this.until = Math.max(this.until, this.now() + STAND_DOWN_MS);
  }
}

const sharedStandDown = new StandDown();

/**
 * `composer/metadata-minifier`'s `expand`: p2 lists only the keys that changed from the previous
 * version, and spells a removed key as `"__unset"`. Entries that are not objects are skipped.
 */
export function expandMinified(versions: readonly unknown[]): Record<string, unknown>[] {
  const expanded: Record<string, unknown>[] = [];
  let previous: Record<string, unknown> = {};
  for (const version of versions) {
    if (!record(version)) continue;
    const current: Record<string, unknown> = { ...previous };
    for (const [key, value] of Object.entries(version)) {
      if (value === "__unset") delete current[key];
      else current[key] = value;
    }
    expanded.push(current);
    previous = current;
  }
  return expanded;
}

/**
 * Pick the version Composer would install from a constraint without a lock: the highest version
 * that satisfies it and is at least as stable as the effective floor. An explicit `@flag`
 * replaces the manifest's `minimum-stability` for this package; a prerelease named in the
 * constraint lowers it. With `prefer-stable`, a stable candidate beats a higher unstable one.
 * Branches are never candidates — they resolve from `vendor/` and `composer.lock` only.
 */
export function selectVersion(
  versions: readonly PackageRecord[],
  constraint: ValidConstraint,
  minimumStability: Stability,
  preferStable: boolean
): PackageRecord | undefined {
  const floor =
    constraint.stabilityFlag ??
    (constraint.impliedStability &&
    compareStability(constraint.impliedStability, minimumStability) < 0
      ? constraint.impliedStability
      : minimumStability);
  const candidates = versions.filter((pkg) => {
    const stability = parseStability(pkg.versionNormalized);
    return (
      stability !== "dev" &&
      compareStability(stability, floor) >= 0 &&
      satisfies(constraint, pkg.versionNormalized)
    );
  });
  const highest = (list: readonly PackageRecord[]) =>
    list.reduce<PackageRecord | undefined>(
      (best, pkg) =>
        best === undefined || compareVersions(pkg.versionNormalized, best.versionNormalized) > 0
          ? pkg
          : best,
      undefined
    );
  if (preferStable) {
    const stable = highest(
      candidates.filter((pkg) => parseStability(pkg.versionNormalized) === "stable")
    );
    if (stable) return stable;
  }
  return highest(candidates);
}

/**
 * Reads package metadata from [Packagist](https://packagist.org/apidoc#get-package-data).

 * One GET of `p2/<vendor>/<name>.json` lists every tagged version with its license, homepage and
 * `require`. The expanded list is cached as a whole: published metadata never changes, and a
 * locked version is read out of the same list a range is resolved against. A miss (404) or a
 * failure is not cached — a package published moments ago may simply not be mirrored yet.
 */
export class PackagistClient {
  private epoch = 0;

  constructor(
    private readonly cache: LicenseCache,
    private readonly standDown: StandDown = sharedStandDown
  ) {}

  invalidate(): void {
    this.epoch++;
  }

  async versions(name: string, token: CancellationLike): Promise<VersionsResult> {
    // v2: v1 entries predate PackageRecord.repository and would mask it for as long as they stay fresh
    const key = `composer:packagist:v2:${name}`;
    const cached = this.cache.get<PackageRecord[]>(key);
    if (cached) return { kind: "found", versions: cached };
    if (!getSetting("composer.useRegistry", true)) {
      return { kind: "unknown", reason: "Packagist lookups are disabled" };
    }
    if (this.standDown.active()) {
      return { kind: "unknown", reason: "Packagist requests paused after HTTP 429" };
    }

    const epoch = this.epoch;
    const url = `${PACKAGIST_P2}/${name}.json`;
    try {
      checkCancelled(token);
      const versions = decodeVersions(await fetchJson<unknown>(url, token), name);
      checkCancelled(token);
      if (epoch === this.epoch) this.cache.set(key, versions);
      return { kind: "found", versions };
    } catch (error) {
      if (token.isCancellationRequested) return { kind: "unknown", reason: "cancelled" };
      if (error instanceof NotFoundError)
        return { kind: "unknown", reason: "not found on Packagist" };
      if (error instanceof Error && error.message.startsWith("HTTP 429 ")) {
        this.standDown.trigger();
        return {
          kind: "unknown",
          reason: "Packagist rate-limited this request; pausing for a minute",
        };
      }
      return { kind: "unknown", reason: `Packagist lookup failed: ${String(error)}` };
    }
  }
}

function decodeVersions(json: unknown, name: string): PackageRecord[] {
  if (!record(json) || !record(json.packages) || !Array.isArray(json.packages[name])) {
    throw new Error("invalid Packagist response");
  }
  const versions: PackageRecord[] = [];
  for (const item of expandMinified(json.packages[name])) {
    const pkg = decodePackageRecord(item, { fromPackagist: true });
    // A broken record is skipped, not fatal for the whole list
    if (pkg) versions.push(pkg);
  }
  return versions;
}
