import semver from "semver";
import type { LicenseCache } from "../../cache";
import { getSetting } from "../../config";
import { NotFoundError, fetchJson } from "../../net";
import type { CancellationLike, LicenseInfo } from "../types";

/** The body of `https://jsr.io/@scope/name/meta.json` */
interface JsrPackageMeta {
  scope?: string;
  name?: string;
  latest?: string;
  versions?: Record<string, { yanked?: boolean }>;
}

/** The body of `https://api.jsr.io/scopes/<scope>/packages/<name>/versions/<version>` */
interface JsrVersionMeta {
  version?: string;
  license?: string | null;
  yanked?: boolean;
}

export interface JsrPackageId {
  readonly scope: string;
  readonly name: string;
}

/** Split `@scope/name` into its JSR scope and package name. JSR packages are always scoped. */
export function parseJsrPackageName(fullName: string): JsrPackageId | undefined {
  const match = /^@([^/@\s]+)\/([^/@\s]+)$/.exec(fullName);
  return match ? { scope: match[1], name: match[2] } : undefined;
}

/**
 * Turn the npm-compatibility name `@jsr/std__fs` back into JSR's `@std/fs`.
 * This is the form JSR packages take when they are used from a package.json.
 */
export function parseJsrNpmCompatName(fullName: string): JsrPackageId | undefined {
  const match = /^@jsr\/([^/@\s_]+)__([^/@\s]+)$/.exec(fullName);
  return match ? { scope: match[1], name: match[2] } : undefined;
}

/**
 * Reads metadata from JSR (jsr.io).

 * The license only exists on the per-version endpoint of api.jsr.io, and it is null unless the package declared a `license` in its deno.json / jsr.json. The npm-compatibility endpoint at npm.jsr.io carries no license at all, so it is not used.
 */
export class JsrClient {
  constructor(private readonly cache: LicenseCache) {}

  private get registryUrl(): string {
    return getSetting("jsr.registry", "https://jsr.io").replace(/\/+$/, "");
  }

  private get apiUrl(): string {
    return getSetting("jsr.apiUrl", "https://api.jsr.io").replace(/\/+$/, "");
  }

  /**
   * The JSR page for one exact version, e.g. `https://jsr.io/@std/fs@1.0.24`. Public so the npm provider can link to it too, for a JSR package it already found installed locally (where it only needs `fetchLicense`, not a full `resolve`).
   */
  packageUrl(id: JsrPackageId, version: string): string {
    return `${this.registryUrl}/@${id.scope}/${id.name}@${version}`;
  }

  /** Resolve one JSR package */
  async resolve(id: JsrPackageId, spec: string, token: CancellationLike): Promise<LicenseInfo> {
    try {
      const version = await this.resolveVersion(id, spec, token);
      if (!version) {
        return { source: "unknown", detail: `no published version matches "${spec}"` };
      }
      const license = await this.fetchLicense(id, version, token);
      const packagePage = this.packageUrl(id, version);
      return {
        license: license ?? undefined,
        version,
        source: "registry",
        via: "jsr.io",
        // JSR's API doesn't expose a separately declared homepage, so the package's own JSR page doubles as both — it's also what the hover title links to.
        homepage: packagePage,
        packagePageUrl: packagePage,
        detail: license ? undefined : "the package declares no license on JSR",
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        return { source: "unknown", detail: "not found on JSR" };
      }
      if (token.isCancellationRequested) {
        return { source: "unknown", detail: "cancelled" };
      }
      return {
        source: "unknown",
        detail: `JSR lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async resolveVersion(
    id: JsrPackageId,
    spec: string,
    token: CancellationLike
  ): Promise<string | undefined> {
    const trimmed = spec.trim();
    const exact = semver.valid(trimmed, { loose: true });
    if (exact) {
      return exact;
    }

    const cacheKey = `jsr:version:${id.scope}/${id.name}@${trimmed}`;
    const cached = this.cache.get<string | null>(cacheKey);
    if (cached !== undefined) {
      return cached ?? undefined;
    }

    const meta = await fetchJson<JsrPackageMeta>(
      `${this.registryUrl}/@${id.scope}/${id.name}/meta.json`,
      token
    );

    let version: string | undefined;
    if (trimmed === "" || trimmed === "*" || trimmed === "latest") {
      version = meta.latest;
    } else {
      // Yanked versions are not candidates
      const available = Object.entries(meta.versions ?? {})
        .filter(([, info]) => !info?.yanked)
        .map(([value]) => value);
      version =
        semver.maxSatisfying(available, trimmed, { loose: true }) ??
        semver.maxSatisfying(available, trimmed, { loose: true, includePrerelease: true }) ??
        undefined;
    }

    this.cache.set(cacheKey, version ?? null);
    return version;
  }

  /**
   * Read the license of one exact, already-known version.

   * Public because the npm provider needs it too: a package installed through the `@jsr` npm-compatibility registry never carries a `license` field in its local package.json (this is a gap in JSR's npm-compat layer, confirmed on both an unlicensed and a licensed package), so once it has the version from node_modules it still has to ask jsr.io for the license.
   */
  async fetchLicense(
    id: JsrPackageId,
    version: string,
    token: CancellationLike
  ): Promise<string | undefined> {
    const cacheKey = `jsr:license:${id.scope}/${id.name}@${version}`;
    const cached = this.cache.get<string | null>(cacheKey);
    if (cached !== undefined) {
      return cached ?? undefined;
    }

    const meta = await fetchJson<JsrVersionMeta>(
      `${this.apiUrl}/scopes/${encodeURIComponent(id.scope)}/packages/${encodeURIComponent(id.name)}/versions/${encodeURIComponent(version)}`,
      token
    );
    const license =
      typeof meta.license === "string" && meta.license.trim().length > 0
        ? meta.license.trim()
        : undefined;

    this.cache.set(cacheKey, license ?? null);
    return license;
  }
}
