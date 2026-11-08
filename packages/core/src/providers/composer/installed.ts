import { TtlCache } from "../../ttlCache";
import type { FileSystemLike, UriLike } from "../types";
import { joinUriPath } from "../uri";
import { decodePackageRecord, type PackageRecord } from "./metadata";

/** Remember lookups briefly so typing does not re-read installed.json on every keystroke */
const CACHE_TTL_MS = 15_000;
/** Upper bound so a workspace with many manifests cannot grow this without limit */
const MAX_CACHE_ENTRIES = 200;

/**
 * Find a package that is already installed under the manifest's vendor directory.

 * Composer writes `<vendor-dir>/composer/installed.json` with every installed package's full
 * record, so one read answers every dependency of a manifest. Composer 2 writes
 * `{"packages": [...], "dev": bool, "dev-package-names": [...]}`; Composer 1 wrote a bare array.
 * There is no fallback to a package's own `composer.json`: it almost never carries a `version`
 * (Composer derives that from VCS tags), so nothing could be checked against the constraint.

 * Parent directories are deliberately not searched. Composer does not hoist, and a monorepo
 * root's `vendor/` would report the wrong version for a nested manifest.
 */
export class InstalledLookup {
  private cache = new TtlCache<ReadonlyMap<string, PackageRecord> | undefined>(
    CACHE_TTL_MS,
    MAX_CACHE_ENTRIES
  );

  constructor(private readonly fs: FileSystemLike) {}

  async find(
    manifestDir: UriLike,
    vendorDir: string,
    name: string
  ): Promise<PackageRecord | undefined> {
    const installedUri = vendorDir.startsWith("/")
      ? manifestDir.with({ path: `${vendorDir.replace(/\/+$/, "")}/composer/installed.json` })
      : joinUriPath(manifestDir, ...vendorDir.split("/"), "composer", "installed.json");
    const cacheKey = installedUri.toString();
    const cached = this.cache.get(cacheKey);
    if (cached) return cached.value?.get(name);

    const packages = await this.read(installedUri);
    this.cache.set(cacheKey, packages);
    return packages?.get(name);
  }

  invalidate(): void {
    this.cache.clear();
  }

  private async read(uri: UriLike): Promise<ReadonlyMap<string, PackageRecord> | undefined> {
    let data: unknown;
    try {
      data = JSON.parse(new TextDecoder().decode(await this.fs.readFile(uri)));
    } catch {
      // Missing or unreadable: nothing is installed here
      return undefined;
    }
    const list = Array.isArray(data)
      ? data
      : typeof data === "object" &&
          data !== null &&
          Array.isArray((data as { packages?: unknown }).packages)
        ? (data as { packages: unknown[] }).packages
        : undefined;
    if (!list) return undefined;
    const byName = new Map<string, PackageRecord>();
    for (const item of list) {
      const pkg = decodePackageRecord(item);
      if (pkg && !byName.has(pkg.name)) byName.set(pkg.name, pkg);
    }
    return byName;
  }
}
