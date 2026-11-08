import { record } from "../../net";
import { decodePackageRecord, type PackageRecord } from "./metadata";

/**
 * composer.lock parsed once and indexed by package name, so a manifest with many dependencies
 * does not re-parse the whole file for every one of them.
 */
export interface ParsedLock {
  /** Every record of `packages` and `packages-dev`, by name */
  readonly packages: ReadonlyMap<string, PackageRecord>;
  /** `alias_normalized` of each entry in the top-level `aliases` array, by package name */
  readonly aliases: ReadonlyMap<string, readonly string[]>;
}

/**
 * Parse a composer.lock. `undefined` when the text is not one this provider understands — not
 * JSON, or neither `packages` nor `packages-dev` is an array — so every name misses.
 * Unlike most lockfiles, composer.lock carries each package's `license`, so a hit here is an answer, not just a pinned version.
 */
export function parseLock(text: string): ParsedLock | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!record(data) || (!Array.isArray(data.packages) && !Array.isArray(data["packages-dev"]))) {
    return undefined;
  }
  const packages = new Map<string, PackageRecord>();
  for (const list of [data.packages, data["packages-dev"]]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const pkg = decodePackageRecord(item);
      if (pkg && !packages.has(pkg.name)) packages.set(pkg.name, pkg);
    }
  }
  const aliases = new Map<string, string[]>();
  if (Array.isArray(data.aliases)) {
    for (const item of data.aliases) {
      if (
        record(item) &&
        typeof item.package === "string" &&
        typeof item.alias_normalized === "string"
      ) {
        const list = aliases.get(item.package);
        if (list) list.push(item.alias_normalized);
        else aliases.set(item.package, [item.alias_normalized]);
      }
    }
  }
  return { packages, aliases };
}
