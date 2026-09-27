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
import { CratesClient } from "./client";
import { parseLock, selectFromParsed, type ParsedLock } from "./lockfile";
import { CargoEntry, parseManifest, type CargoManifest } from "./parse";
import { parseRequirement } from "./spec";
import { CargoWorkspace } from "./workspace";

export class CratesLicenseProvider implements LicenseProvider {
  readonly id = "crates";
  private readonly workspace: CargoWorkspace;
  private readonly client: CratesClient;
  /**
   * The last parse of each Cargo.lock, reused as long as its text has not changed.
   *
   * A manifest resolves one dependency at a time, but they all share the same Cargo.lock — without
   * this, a manifest with many dependencies would re-parse that file (which, unlike Cargo.toml,
   * also lists every transitive dependency) from scratch for every single one of them. Keyed by
   * URI; per-workspace-root, so bounded by how many Cargo workspaces are open at once rather than
   * by dependency or directory count the way the TtlCache-based provider caches are.
   */
  private readonly lockCache = new Map<
    string,
    { readonly text: string; readonly parsed: ParsedLock }
  >();
  /**
   * The last parse of each open Cargo.toml document, reused as long as its text has not changed.
   *
   * `parse()` runs once per document, but `resolve()` runs once per dependency and needs the
   * manifest too (for `workspace`/`workspacePath`/`overrides`) — without this, a manifest with N
   * dependencies parsed its own text N+1 times (once from `parse()`, again from every `resolve()`)
   * instead of once. Bounded the same way `lockCache` is: by how many Cargo.toml documents this
   * provider instance has touched, not by dependency count.
   */
  private readonly manifestCache = new Map<
    string,
    { readonly text: string; readonly manifest: CargoManifest | undefined }
  >();
  constructor(
    cache: LicenseCache,
    private readonly host: ProviderHost
  ) {
    this.workspace = new CargoWorkspace(host.fs);
    this.client = new CratesClient(cache);
  }
  supports(document: TextDocumentLike): boolean {
    return this.host.parseUri(document.uri).path.endsWith("/Cargo.toml");
  }
  isEnabled(): boolean {
    return getSetting("crates.enabled", true);
  }
  parse(document: TextDocumentLike): CargoEntry[] {
    return this.parsedManifest(document.uri, document.getText())?.entries ?? [];
  }
  cacheKey(entry: DependencyEntry): string {
    return entry instanceof CargoEntry
      ? `crates:${JSON.stringify([entry.manifestUri, entry.name, entry.section, entry.declaration, entry.context])}`
      : `crates:invalid:${entry.name}`;
  }
  invalidate(): void {
    this.workspace.invalidate();
    this.client.invalidate();
    this.lockCache.clear();
    this.manifestCache.clear();
  }

  private parsedLock(uriKey: string, text: string): ParsedLock {
    const cached = this.lockCache.get(uriKey);
    if (cached && cached.text === text) {
      return cached.parsed;
    }
    const parsed = parseLock(text);
    this.lockCache.set(uriKey, { text, parsed });
    return parsed;
  }

  private parsedManifest(uriKey: string, text: string): CargoManifest | undefined {
    const cached = this.manifestCache.get(uriKey);
    if (cached && cached.text === text) {
      return cached.manifest;
    }
    const manifest = parseManifest(text, uriKey);
    this.manifestCache.set(uriKey, { text, manifest });
    return manifest;
  }

  async resolve(
    entry: DependencyEntry,
    document: TextDocumentLike,
    token: CancellationLike
  ): Promise<LicenseInfo> {
    if (!(entry instanceof CargoEntry)) return { source: "unknown", detail: "invalid Cargo entry" };
    let spec = entry.declaration;
    if (spec.kind === "skipped" || spec.kind === "unknown")
      return { source: spec.kind, detail: spec.reason };
    const manifest = this.parsedManifest(document.uri, document.getText());
    if (!manifest) return { source: "unknown", detail: "invalid Cargo manifest" };
    const root = await this.workspace.root(this.host.parseUri(document.uri), manifest);
    if (root.kind === "unknown") return { source: "unknown", detail: root.reason };
    if (spec.kind === "workspace") {
      const inherited = root.manifest.entries.find(
        (e) => e.section === "workspace.dependencies" && e.name === entry.name
      );
      if (!inherited || inherited.declaration.kind === "workspace")
        return { source: "unknown", detail: "workspace dependency could not be resolved" };
      spec = inherited.declaration;
    }
    if (spec.kind === "skipped" || spec.kind === "unknown")
      return { source: spec.kind, detail: spec.reason };
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(spec.name))
      return { source: "unknown", detail: "invalid crate name" };
    if (root.manifest.overrides.includes(spec.name))
      return { source: "skipped", detail: "root manifest overrides this package" };
    const requirement = parseRequirement(spec.requirement);
    if (requirement.kind === "invalid")
      return { source: "unknown", detail: "invalid Cargo version requirement" };
    let locked: string | undefined;
    if (getSetting("crates.useLockfiles", true)) {
      const lockUri = joinUriPath(root.uri, "..", "Cargo.lock");
      const read = await this.workspace.read(lockUri);
      if (read.kind === "found") {
        const parsed = this.parsedLock(lockUri.toString(), read.text);
        const selection = selectFromParsed(parsed, spec.name, requirement);
        if (selection.kind === "selected") locked = selection.version;
      }
    }
    const result = await this.client.metadata(spec.name, requirement, locked, token);
    const via = locked ? "Cargo.lock + crates.io" : "manifest requirement + crates.io";
    if (result.kind === "unknown")
      return { source: "unknown", version: locked, via, detail: result.reason };
    const metadata = result.metadata;
    return {
      source: "registry",
      license: metadata.license,
      version: metadata.version,
      homepage: metadata.homepage,
      packagePageUrl: `https://crates.io/crates/${encodeURIComponent(spec.name)}/${encodeURIComponent(metadata.version)}`,
      via,
      detail: metadata.license ? undefined : "license string unavailable in published metadata",
    };
  }
}
