import type { LicenseCache } from "../../cache";
import { getSetting } from "../../config";
import { checkCancelled, fetchJson } from "../../net";
import { record } from "../../net";
import type { CancellationLike } from "../types";
import { compareVersions, matchesRequirement, validVersion, type Requirement } from "./spec";

export interface GemVersion {
  version: string;
  /** License strings as published, `undefined` when the release declares none */
  licenses?: string[];
  prerelease: boolean;
  platform?: string;
  homepage?: string;
  /** The release's `required_ruby_version`, e.g. `">= 3.0"` — `undefined` when unconstrained (the API reports `">= 0"`) */
  rubyVersion?: string;
}

export type MetadataResult =
  { kind: "found"; metadata: GemVersion } | { kind: "unknown"; reason: string };

function decodeVersion(value: unknown): GemVersion {
  if (
    !record(value) ||
    typeof value.number !== "string" ||
    !validVersion(value.number) ||
    typeof value.prerelease !== "boolean" ||
    (value.licenses != null &&
      (!Array.isArray(value.licenses) ||
        value.licenses.some((license) => typeof license !== "string"))) ||
    (value.platform != null && typeof value.platform !== "string") ||
    (value.ruby_version != null && typeof value.ruby_version !== "string")
  ) {
    throw new Error("invalid RubyGems version metadata");
  }
  const metadata = record(value.metadata) ? value.metadata : undefined;
  const homepage =
    metadata && typeof metadata.homepage_uri === "string" ? metadata.homepage_uri : undefined;
  const licenses = Array.isArray(value.licenses)
    ? value.licenses.map((license) => license.trim()).filter((license) => license.length > 0)
    : undefined;
  const rubyRequirement = typeof value.ruby_version === "string" ? value.ruby_version.trim() : "";
  return {
    version: value.number,
    licenses: licenses && licenses.length > 0 ? licenses : undefined,
    prerelease: value.prerelease,
    platform: typeof value.platform === "string" ? value.platform : undefined,
    homepage,
    // ">= 0" is how the API spells "no constraint declared"
    rubyVersion: rubyRequirement && rubyRequirement !== ">= 0" ? rubyRequirement : undefined,
  };
}

/**
 * Reads gem licenses from [RubyGems](https://guides.rubygems.org/rubygems-org-api/).
 *
 * One request — `GET /api/v1/versions/<name>.json` — lists every published
 * version of a gem together with the licenses that version declares, the same
 * shape the crates.io client is built on: a locked version is read out of the
 * list, and without a lock the highest version satisfying the requirement is
 * selected from it. The list is cached as a whole; a version's metadata never
 * changes once published.
 */
export class RubyGemsClient {
  private epoch = 0;

  constructor(private readonly cache: LicenseCache) {}

  invalidate(): void {
    this.epoch++;
  }

  private async versionList(
    name: string,
    token: CancellationLike
  ): Promise<{ kind: "found"; versions: GemVersion[] } | { kind: "unknown"; reason: string }> {
    const listKey = `rubygems:versions:v1:${name}`;
    const cached = this.cache.get<GemVersion[]>(listKey);
    if (cached) return { kind: "found", versions: cached };
    if (!getSetting("rubygems.useRegistry", true)) {
      return { kind: "unknown", reason: "registry disabled and no cached public versions" };
    }
    const epoch = this.epoch;
    try {
      checkCancelled(token);
      const json = await fetchJson<unknown>(
        `https://rubygems.org/api/v1/versions/${encodeURIComponent(name)}.json`,
        token
      );
      checkCancelled(token);
      if (!Array.isArray(json)) throw new Error("invalid RubyGems response");
      // A single malformed record should not throw away every other version
      // this gem actually has — the same rule the crates.io client applies.
      const decoded = json.flatMap((entry) => {
        try {
          return [decodeVersion(entry)];
        } catch {
          return [];
        }
      });
      if (decoded.length === 0 && json.length > 0) {
        throw new Error("no version record could be decoded");
      }
      if (epoch === this.epoch) this.cache.set(listKey, decoded);
      return { kind: "found", versions: decoded };
    } catch (error) {
      return {
        kind: "unknown",
        reason: token.isCancellationRequested
          ? "cancelled"
          : `RubyGems lookup failed: ${String(error)}`,
      };
    }
  }

  async metadata(
    name: string,
    requirement: Requirement,
    locked: string | undefined,
    token: CancellationLike
  ): Promise<MetadataResult> {
    if (
      locked &&
      !getSetting("rubygems.useRegistry", true) &&
      !this.cache.get<GemVersion[]>(`rubygems:versions:v1:${name}`)
    ) {
      return { kind: "unknown", reason: "registry disabled; Gemfile.lock carries no license" };
    }
    const list = await this.versionList(name, token);
    if (list.kind === "unknown") return list;
    const versions = preferRubyPlatform(list.versions);
    if (locked) {
      const selected = versions.find((candidate) => candidate.version === locked);
      return selected
        ? { kind: "found", metadata: selected }
        : { kind: "unknown", reason: "locked version is not published on RubyGems" };
    }
    const selected = versions
      .filter((candidate) => matchesRequirement(requirement, candidate.version))
      .sort((a, b) => compareVersions(b.version, a.version))[0];
    return selected
      ? { kind: "found", metadata: selected }
      : { kind: "unknown", reason: "no matching public version" };
  }
}

/**
 * The versions endpoint carries one record per platform build of a release
 * (`ruby`, `java`, `x64-mingw32`, …). They are the same release with the same
 * declared licenses, so collapse them, preferring the plain `ruby` record.
 */
function preferRubyPlatform(versions: readonly GemVersion[]): GemVersion[] {
  const byVersion = new Map<string, GemVersion>();
  for (const candidate of versions) {
    const existing = byVersion.get(candidate.version);
    if (!existing || (existing.platform !== "ruby" && candidate.platform === "ruby")) {
      byVersion.set(candidate.version, candidate);
    }
  }
  return [...byVersion.values()];
}

/**
 * One SPDX expression for everything a release declares.
 *
 * A gemspec's `licenses` list names every license the gem is distributed
 * under, so several entries are joined with `AND` — the same reading the Go
 * provider gives the several license files deps.dev finds in one module.
 */
export function combineLicenses(licenses: readonly string[] | undefined): string | undefined {
  if (!licenses) return undefined;
  const known = [...new Set(licenses.map((license) => license.trim()).filter(Boolean))];
  if (known.length <= 1) return known[0];
  return known
    .map((license) => (/\s(?:AND|OR)\s/.test(license) ? `(${license})` : license))
    .join(" AND ");
}
