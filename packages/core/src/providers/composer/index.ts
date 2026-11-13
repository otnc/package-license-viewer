import type { LicenseCache } from "../../cache";
import { getSetting } from "../../config";
import { log } from "../../log";
import type {
  CancellationLike,
  DependencyEntry,
  LicenseInfo,
  LicenseProvider,
  ProviderHost,
  TextDocumentLike,
} from "../types";
import { joinUriPath } from "../uri";
import { PackagistClient, selectVersion } from "./client";
import { InstalledLookup } from "./installed";
import { parseLock, type ParsedLock } from "./lockfile";
import { packagePageUrl, recordSatisfies, type PackageRecord } from "./metadata";
import {
  ComposerEntry,
  type ComposerManifest,
  isComposerJsonPath,
  isPackageName,
  parseComposerJson,
} from "./parse";

/**
 * Provider for Composer manifests (`composer.json`).

 * Resolution order mirrors the npm provider:
 *  1. `vendor/composer/installed.json` — what is actually installed. Offline, instant, and it carries the license.
 *  2. `composer.lock` — also carries the license, so this is an answer, not just a pinned version.
 *  3. Packagist — resolve the constraint against the published versions as a last resort.

 * A vendored or locked version that no longer satisfies the constraint written in `composer.json` falls through instead of being reported, so a stale lock never lies. `dev-*` branches resolve from steps 1 and 2 only. Nothing runs `composer`, and no private repository is contacted.
 */
export class ComposerLicenseProvider implements LicenseProvider {
  readonly id = "composer";

  private readonly installed: InstalledLookup;
  private readonly client: PackagistClient;
  /** The last parse of each open manifest, reused as long as its text has not changed */
  private readonly manifestCache = new Map<
    string,
    { readonly text: string; readonly manifest: ComposerManifest }
  >();
  /** The last parse of each composer.lock, reused as long as its text has not changed */
  private readonly lockCache = new Map<
    string,
    { readonly text: string; readonly parsed: ParsedLock | undefined }
  >();

  constructor(
    cache: LicenseCache,
    private readonly host: ProviderHost
  ) {
    this.installed = new InstalledLookup(host.fs);
    this.client = new PackagistClient(cache);
  }

  supports(document: TextDocumentLike): boolean {
    return isComposerJsonPath(this.host.parseUri(document.uri).path);
  }

  isEnabled(): boolean {
    return getSetting("composer.enabled", true);
  }

  parse(document: TextDocumentLike): ComposerEntry[] {
    return this.parsedManifest(document).entries;
  }

  cacheKey(entry: DependencyEntry): string {
    return entry instanceof ComposerEntry
      ? `composer:${JSON.stringify([entry.manifestDir, entry.name, entry.spec])}`
      : `composer:invalid:${entry.name}`;
  }

  invalidate(): void {
    this.installed.invalidate();
    this.client.invalidate();
    this.manifestCache.clear();
    this.lockCache.clear();
  }

  private parsedManifest(document: TextDocumentLike): ComposerManifest {
    const text = document.getText();
    const cached = this.manifestCache.get(document.uri);
    if (cached && cached.text === text) return cached.manifest;
    const manifestDir = joinUriPath(this.host.parseUri(document.uri), "..").toString();
    const manifest = parseComposerJson(document, manifestDir);
    this.manifestCache.set(document.uri, { text, manifest });
    return manifest;
  }

  private parsedLock(uriKey: string, text: string): ParsedLock | undefined {
    const cached = this.lockCache.get(uriKey);
    if (cached && cached.text === text) return cached.parsed;
    const parsed = parseLock(text);
    this.lockCache.set(uriKey, { text, parsed });
    return parsed;
  }

  async resolve(
    entry: DependencyEntry,
    document: TextDocumentLike,
    token: CancellationLike
  ): Promise<LicenseInfo> {
    if (!(entry instanceof ComposerEntry)) {
      return { source: "unknown", detail: "invalid Composer entry" };
    }
    if (!isPackageName(entry.name)) {
      return { source: "unknown", detail: "invalid package name" };
    }
    const manifest = this.parsedManifest(document);
    const manifestDir = joinUriPath(this.host.parseUri(document.uri), "..");
    const constraint = entry.constraint;
    const unchecked =
      constraint.kind === "invalid" ? "version constraint could not be checked" : undefined;

    // 1. Whatever is installed wins
    const installed = await this.installed.find(manifestDir, manifest.vendorDir, entry.name);
    if (installed) {
      if (constraint.kind === "invalid" || recordSatisfies(installed, constraint, [])) {
        return report(installed, "local", "installed package (`vendor/`)", unchecked);
      }
      log.debug(
        `composer: installed ${entry.name}@${installed.version} does not satisfy ${entry.spec}`
      );
    }

    // 2. composer.lock carries the license too
    if (getSetting("composer.useLockfiles", true)) {
      const lockUri = joinUriPath(manifestDir, "composer.lock");
      let lock: ParsedLock | undefined;
      try {
        const bytes = await this.host.fs.readFile(lockUri);
        lock = this.parsedLock(lockUri.toString(), new TextDecoder().decode(bytes));
      } catch {
        // No readable composer.lock beside the manifest
      }
      const locked = lock?.packages.get(entry.name);
      if (locked) {
        const aliases = lock?.aliases.get(entry.name) ?? [];
        if (constraint.kind === "invalid" || recordSatisfies(locked, constraint, aliases)) {
          return report(locked, "lockfile", "`composer.lock`", unchecked);
        }
        log.debug(
          `composer: locked ${entry.name}@${locked.version} does not satisfy ${entry.spec}`
        );
      }
    }

    // 3. Packagist
    if (constraint.kind === "invalid") {
      return { source: "unknown", detail: "unsupported version constraint" };
    }
    if (constraint.devBranch) {
      return {
        source: "unknown",
        detail: "branch requirements resolve only from vendor/ or composer.lock",
      };
    }
    if (!manifest.packagistEnabled) {
      return { source: "unknown", detail: "Packagist is disabled in composer.json" };
    }
    const result = await this.client.versions(entry.name, token);
    if (result.kind === "unknown") {
      return { source: "unknown", detail: result.reason };
    }
    const selected = selectVersion(
      result.versions,
      constraint,
      manifest.minimumStability,
      manifest.preferStable
    );
    if (!selected) {
      return { source: "unknown", detail: "no Packagist version satisfies the constraint" };
    }
    return report(selected, "registry", "packagist.org", undefined);
  }
}

function report(
  pkg: PackageRecord,
  source: "local" | "lockfile" | "registry",
  via: string | undefined,
  detail: string | undefined
): LicenseInfo {
  const note = detail ?? (pkg.license ? undefined : "no license declared");
  return {
    source,
    license: pkg.license,
    version: pkg.version,
    ...(pkg.homepage ? { homepage: pkg.homepage } : {}),
    ...(pkg.repository ? { repository: pkg.repository } : {}),
    ...(pkg.phpVersion ? { phpVersion: pkg.phpVersion } : {}),
    ...(pkg.fromPackagist ? { packagePageUrl: packagePageUrl(pkg.name, pkg.version) } : {}),
    ...(via ? { via } : {}),
    ...(note ? { detail: note } : {}),
  };
}

export { ComposerEntry, parseComposerJson } from "./parse";
