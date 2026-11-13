import type { LicenseCache } from "../../cache";
import { getSetting } from "../../config";
import type {
  CancellationLike,
  DependencyEntry,
  LicenseInfo,
  LicenseProvider,
  ProviderHost,
  TextDocumentLike,
} from "../types";
import { joinUriPath } from "../uri";
import { combineLicenses, RubyGemsClient } from "./client";
import { parseLock, selectFromParsed, type ParsedLock } from "./lockfile";
import { isGemfilePath, isGemspecPath, parseGemfile, parseGemspec, RubyEntry } from "./parse";
import { parseRequirement } from "./spec";

/**
 * Provider for Ruby manifests: a Bundler `Gemfile` and `.gemspec` files.
 *
 * Licenses come from rubygems.org, whose versions API reports the licenses of
 * every published version in one request. A `Gemfile.lock` beside the
 * manifest pins the exact version when it holds a unique match; otherwise
 * the highest public version satisfying the declared requirement is used.
 * Nothing runs `ruby` or `bundle`, and no installed gem is read.
 */
export class RubyGemsLicenseProvider implements LicenseProvider {
  readonly id = "rubygems";

  private readonly client: RubyGemsClient;
  /** The last parse of each Gemfile.lock, reused as long as its text has not changed */
  private readonly lockCache = new Map<
    string,
    { readonly text: string; readonly parsed: ParsedLock }
  >();
  /** The last parse of each open manifest, reused as long as its text has not changed */
  private readonly manifestCache = new Map<
    string,
    { readonly text: string; readonly entries: RubyEntry[] }
  >();

  constructor(
    cache: LicenseCache,
    private readonly host: ProviderHost
  ) {
    this.client = new RubyGemsClient(cache);
  }

  supports(document: TextDocumentLike): boolean {
    const path = this.host.parseUri(document.uri).path;
    return isGemfilePath(path) || isGemspecPath(path);
  }

  isEnabled(): boolean {
    return getSetting("rubygems.enabled", true);
  }

  parse(document: TextDocumentLike): RubyEntry[] {
    return this.parsedManifest(document.uri, document.getText()).entries;
  }

  cacheKey(entry: DependencyEntry): string {
    return entry instanceof RubyEntry
      ? `rubygems:${JSON.stringify([entry.manifestUri, entry.name, entry.section, entry.declaration])}`
      : `rubygems:invalid:${entry.name}`;
  }

  invalidate(): void {
    this.client.invalidate();
    this.lockCache.clear();
    this.manifestCache.clear();
  }

  private parsedManifest(uriKey: string, text: string): { entries: RubyEntry[] } {
    const cached = this.manifestCache.get(uriKey);
    if (cached && cached.text === text) return cached;
    const path = this.host.parseUri(uriKey).path;
    const entries = isGemspecPath(path) ? parseGemspec(text, uriKey) : parseGemfile(text, uriKey);
    const manifest = { text, entries };
    this.manifestCache.set(uriKey, manifest);
    return manifest;
  }

  private parsedLock(uriKey: string, text: string): ParsedLock {
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
    if (!(entry instanceof RubyEntry)) {
      return { source: "unknown", detail: "invalid Ruby entry" };
    }
    const declaration = entry.declaration;
    if (declaration.kind === "skipped" || declaration.kind === "unknown") {
      return { source: declaration.kind, detail: declaration.reason };
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(declaration.name)) {
      return { source: "unknown", detail: "invalid gem name" };
    }
    const requirement = parseRequirement(declaration.requirements);
    if (requirement.kind === "invalid") {
      return { source: "unknown", detail: "invalid RubyGems version requirement" };
    }

    let locked: string | undefined;
    if (getSetting("rubygems.useLockfiles", true)) {
      const documentUri = this.host.parseUri(document.uri);
      const lockUri = joinUriPath(documentUri, "..", "Gemfile.lock");
      try {
        const bytes = await this.host.fs.readFile(lockUri);
        const parsed = this.parsedLock(lockUri.toString(), new TextDecoder().decode(bytes));
        const selection = selectFromParsed(parsed, declaration.name, requirement);
        if (selection.kind === "selected") locked = selection.version;
      } catch {
        // No readable Gemfile.lock beside the manifest: resolve from the requirement
      }
    }

    const result = await this.client.metadata(declaration.name, requirement, locked, token);
    const via = locked ? "Gemfile.lock + RubyGems" : "manifest requirement + RubyGems";
    if (result.kind === "unknown") {
      return { source: "unknown", version: locked, via, detail: result.reason };
    }
    const metadata = result.metadata;
    const license = combineLicenses(metadata.licenses);
    return {
      source: "registry",
      license,
      version: metadata.version,
      homepage: metadata.homepage,
      repository: metadata.repository,
      packagePageUrl: `https://rubygems.org/gems/${encodeURIComponent(declaration.name)}/versions/${encodeURIComponent(metadata.version)}`,
      via,
      detail: license ? undefined : "license unavailable in published metadata",
      ...(metadata.rubyVersion ? { rubyVersion: metadata.rubyVersion } : {}),
    };
  }
}

export { RubyEntry, parseGemfile, parseGemspec } from "./parse";
