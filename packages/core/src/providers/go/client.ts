import type { LicenseCache } from "../../cache";
import { getSetting } from "../../config";
import { checkCancelled, fetchJson, NotFoundError, record } from "../../net";
import type { CancellationLike } from "../types";

/** What deps.dev knows about one module version */
export interface GoModuleVersion {
  /** One SPDX expression per license deps.dev found in the module, `non-standard` when it found one it could not identify */
  readonly licenses: readonly string[];
  readonly sourceRepo?: string;
}

export type VersionResult =
  { kind: "found"; module: GoModuleVersion } | { kind: "unknown"; reason: string };

const API = "https://api.deps.dev/v3/systems/go/packages";

/** The page a module's hover title links to */
export function modulePageUrl(path: string, version: string): string {
  return `https://pkg.go.dev/${path}@${version}`;
}

/**
 * Reads module licenses from [deps.dev](https://docs.deps.dev/api/v3/).

 * The Go module mirror serves zips and `go.mod` files but no license metadata, and pkg.go.dev has no API for it, so this asks deps.dev, which detects the licenses in the modules the mirror serves. One request per module version answers everything: `GetVersion` carries the licenses and the source repository. A version's contents never change, so a found answer is cached; a miss is not, since deps.dev may simply not have ingested a fresh release yet.
 */
export class DepsDevClient {
  private epoch = 0;

  constructor(private readonly cache: LicenseCache) {}

  invalidate(): void {
    this.epoch++;
  }

  async version(path: string, version: string, token: CancellationLike): Promise<VersionResult> {
    const key = `go:depsdev:v1:${path}@${version}`;
    const cached = this.cache.get<GoModuleVersion>(key);
    if (cached) {
      return { kind: "found", module: cached };
    }
    if (!getSetting("go.useRegistry", true)) {
      return { kind: "unknown", reason: "deps.dev lookups are disabled" };
    }

    const epoch = this.epoch;
    const url = `${API}/${encodeURIComponent(path)}/versions/${encodeURIComponent(version)}`;
    try {
      checkCancelled(token);
      const module = decodeVersion(await fetchJson<unknown>(url, token), path, version);
      checkCancelled(token);
      if (epoch === this.epoch) {
        this.cache.set(key, module);
      }
      return { kind: "found", module };
    } catch (error) {
      if (token.isCancellationRequested) {
        return { kind: "unknown", reason: "cancelled" };
      }
      if (error instanceof NotFoundError) {
        return { kind: "unknown", reason: "deps.dev has no record of this module version" };
      }
      return { kind: "unknown", reason: `deps.dev lookup failed: ${String(error)}` };
    }
  }
}

function decodeVersion(json: unknown, path: string, version: string): GoModuleVersion {
  if (!record(json) || !record(json.versionKey)) {
    throw new Error("invalid deps.dev response");
  }
  if (json.versionKey.name !== path || json.versionKey.version !== version) {
    throw new Error("deps.dev returned a different module version");
  }
  const licenses = Array.isArray(json.licenses)
    ? json.licenses.filter((license): license is string => typeof license === "string")
    : [];
  const sourceRepo = Array.isArray(json.links)
    ? json.links.find(
        (link): link is { url: string } =>
          record(link) && link.label === "SOURCE_REPO" && typeof link.url === "string"
      )?.url
    : undefined;
  return { licenses, sourceRepo };
}

/**
 * One SPDX expression for everything deps.dev found.

 * Each entry stands for a license file somewhere in the module, and a module carrying two (say Apache-2.0 for most of it and MIT for a vendored part) is under both at once, so they are joined with `AND` — not `OR`, which would claim a choice nobody offered. `non-standard` is deps.dev saying it found a license it could not name, which says nothing a reader can act on.
 */
export function combineLicenses(licenses: readonly string[]): string | undefined {
  const known = [
    ...new Set(licenses.map((license) => license.trim()).filter((l) => l && l !== "non-standard")),
  ];
  if (known.length <= 1) return known[0];
  return known
    .map((license) => (/\s(?:AND|OR)\s/.test(license) ? `(${license})` : license))
    .join(" AND ");
}
