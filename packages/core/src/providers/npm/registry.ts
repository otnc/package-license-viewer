import semver from "semver";
import type { LicenseCache } from "../../cache";
import { getSetting } from "../../config";
import { NotFoundError, fetchJson } from "../../net";
import type { CancellationLike } from "../types";
import { type NpmManifest, normalizeLicense, normalizeNodeEngine } from "./manifest";
import { encodePackageName } from "./spec";

/** Abbreviated registry metadata. It has no license, so it is only good for picking a version. */
interface AbbreviatedPackument {
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, unknown>;
}

export interface FetchedManifest {
  license?: string;
  homepage?: string;
  nodeEngine?: string;
}

function toFetchedManifest(manifest: NpmManifest): FetchedManifest {
  return {
    license: normalizeLicense(manifest),
    homepage: manifest.homepage,
    nodeEngine: normalizeNodeEngine(manifest),
  };
}

/**
 * Talks to an npm-compatible registry. Pointing it at a different base URL is enough to reuse it elsewhere.
 */
export class NpmRegistryClient {
  constructor(
    private readonly cache: LicenseCache,
    private readonly namespace = "npm"
  ) {}

  private get baseUrl(): string {
    return getSetting("npm.registry", "https://registry.npmjs.org").replace(/\/+$/, "");
  }

  /** Turn a specifier into a concrete version */
  async resolveVersion(
    name: string,
    spec: string,
    kind: "range" | "tag",
    token: CancellationLike
  ): Promise<string | undefined> {
    // An exact version needs no metadata at all
    if (kind === "range") {
      const exact = semver.valid(spec, { loose: true });
      if (exact) {
        return exact;
      }
    }

    const encoded = encodePackageName(name);
    const cacheKey = `${this.namespace}:version:${encoded}@${spec}`;
    const cached = this.cache.get<string | null>(cacheKey);
    if (cached !== undefined) {
      return cached ?? undefined;
    }

    // The abbreviated document omits the license but is far smaller, and it is all that version resolution needs
    const packument = await fetchJson<AbbreviatedPackument>(
      `${this.baseUrl}/${encoded}`,
      token,
      "application/vnd.npm.install-v1+json"
    );

    let version: string | undefined;
    if (kind === "tag") {
      version = packument["dist-tags"]?.[spec];
    } else {
      const available = Object.keys(packument.versions ?? {});
      version =
        semver.maxSatisfying(available, spec, { loose: true }) ??
        // Nothing matched, so try again with prereleases in scope
        semver.maxSatisfying(available, spec, { loose: true, includePrerelease: true }) ??
        undefined;
    }

    this.cache.set(cacheKey, version ?? null);
    return version;
  }

  /**
   * Read the license of one exact version. The answer can never change, so it is safe to cache for a long time.
   */
  async fetchLicense(
    name: string,
    version: string,
    token: CancellationLike
  ): Promise<FetchedManifest> {
    const encoded = encodePackageName(name);
    // Versioned so that adding a field to FetchedManifest (as nodeEngine was) can't be masked for up to a week by a still-fresh cache entry from before that field existed.
    const cacheKey = `${this.namespace}:manifest:v2:${encoded}@${version}`;
    const cached = this.cache.get<FetchedManifest>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    let result: FetchedManifest;
    try {
      const manifest = await fetchJson<NpmManifest>(`${this.baseUrl}/${encoded}/${version}`, token);
      result = toFetchedManifest(manifest);
    } catch (error) {
      // Some registries have no single-version endpoint, so fall back to the full document
      if (!(error instanceof NotFoundError)) {
        throw error;
      }
      const packument = await fetchJson<{ versions?: Record<string, NpmManifest> }>(
        `${this.baseUrl}/${encoded}`,
        token
      );
      const manifest = packument.versions?.[version];
      if (!manifest) {
        throw error;
      }
      result = toFetchedManifest(manifest);
    }

    this.cache.set(cacheKey, result);
    return result;
  }
}
