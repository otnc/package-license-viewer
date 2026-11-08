import { record } from "../../net";
import { normalizeVersion, parseStability, satisfies, type ValidConstraint } from "./spec";

/** The `notification-url` Composer writes into every package record that came from Packagist */
export const PACKAGIST_NOTIFICATION_URL = "https://packagist.org/downloads/";

/**
 * One package version, in the shape shared by `vendor/composer/installed.json`, `composer.lock`
 * and Packagist's p2 metadata — all three serialize the same `composer.json`-derived record.
 */
export interface PackageRecord {
  readonly name: string;
  /** Pretty version as recorded, e.g. `v3.0.2` or `dev-master` */
  readonly version: string;
  /** `version_normalized`, else `normalizeVersion(version)` */
  readonly versionNormalized: string;
  /** One SPDX-ish expression; several declared licenses are a choice, joined with ` OR ` */
  readonly license?: string;
  readonly homepage?: string;
  /** The package's own `require.php` constraint, trimmed */
  readonly phpVersion?: string;
  /** `extra.branch-alias` as written, e.g. `{ "dev-master": "3.x-dev" }` */
  readonly branchAliases: Readonly<Record<string, string>>;
  /** Whether Packagist is known to serve this package, so its page can be linked without a 404 */
  readonly fromPackagist: boolean;
}

/**
 * Composer's `license` is a string or an array. The array form is disjunctive by Composer's
 * definition ("the user may pick one"), so entries are joined with `OR` — the opposite of the
 * deps.dev convention the Go provider follows. A string, including Composer's parenthesized
 * `(A or B)` / `(A and B)` forms and the special value `proprietary`, is passed through.
 */
export function combineLicenses(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (!Array.isArray(value)) return undefined;
  const licenses = [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    ),
  ];
  return licenses.length > 0 ? licenses.join(" OR ") : undefined;
}

/**
 * Decode one package record. `undefined` when it lacks a name or a version Composer could
 * normalize — such a record can neither be matched against a constraint nor displayed.
 * `fromPackagist` defaults to the `notification-url` test; a p2 caller passes `true`, since
 * everything in that response is by definition served by Packagist.
 */
export function decodePackageRecord(
  value: unknown,
  options: { readonly fromPackagist?: boolean } = {}
): PackageRecord | undefined {
  if (!record(value) || typeof value.name !== "string" || typeof value.version !== "string") {
    return undefined;
  }
  const versionNormalized =
    typeof value.version_normalized === "string"
      ? value.version_normalized
      : normalizeVersion(value.version);
  if (versionNormalized === undefined) return undefined;

  const license = combineLicenses(value.license);
  const homepage = typeof value.homepage === "string" ? value.homepage.trim() : "";
  const php =
    record(value.require) && typeof value.require.php === "string" ? value.require.php.trim() : "";
  const branchAliases: Record<string, string> = {};
  if (record(value.extra) && record(value.extra["branch-alias"])) {
    for (const [branch, alias] of Object.entries(value.extra["branch-alias"])) {
      if (typeof alias === "string") branchAliases[branch] = alias;
    }
  }
  return {
    name: value.name,
    version: value.version,
    versionNormalized,
    ...(license ? { license } : {}),
    ...(homepage ? { homepage } : {}),
    ...(php ? { phpVersion: php } : {}),
    branchAliases,
    fromPackagist:
      options.fromPackagist ?? value["notification-url"] === PACKAGIST_NOTIFICATION_URL,
  };
}

/**
 * Whether an installed or locked record is what the manifest currently asks for.

 * A numeric version simply has to satisfy the constraint. A `dev-*` branch satisfies it when the
 * constraint names that branch, or when one of the branch's aliases does — the constraint's own
 * `as` clause, the record's `extra.branch-alias`, or the aliases `composer.lock` records for the
 * package. That is how Composer itself lets `^1.0` be met by `dev-main`, and it keeps "what is
 * installed wins" true for a package legitimately installed from a branch. A stale lock, whose
 * version no longer satisfies the constraint, fails this check and falls through to the registry.
 */
export function recordSatisfies(
  pkg: PackageRecord,
  constraint: ValidConstraint,
  lockAliases: readonly string[]
): boolean {
  if (satisfies(constraint, pkg.versionNormalized)) return true;
  if (parseStability(pkg.versionNormalized) !== "dev") return false;
  const aliases = [
    constraint.alias,
    pkg.branchAliases[pkg.version],
    pkg.branchAliases[pkg.versionNormalized],
    ...lockAliases,
  ];
  return aliases.some((alias) => alias !== undefined && satisfies(constraint, alias));
}

/** The page a package's hover title links to; Packagist anchors a version with `#` */
export function packagePageUrl(name: string, version: string): string {
  return `https://packagist.org/packages/${name}#${version}`;
}
