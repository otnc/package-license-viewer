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
import { selectLocked } from "./lockfile";
import { CargoEntry, parseManifest } from "./parse";
import { parseRequirement } from "./spec";
import { CargoWorkspace } from "./workspace";

export class CratesLicenseProvider implements LicenseProvider {
  readonly id = "crates";
  private readonly workspace: CargoWorkspace;
  private readonly client: CratesClient;
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
    return parseManifest(document.getText(), document.uri)?.entries ?? [];
  }
  cacheKey(entry: DependencyEntry): string {
    return entry instanceof CargoEntry
      ? `crates:${JSON.stringify([entry.manifestUri, entry.name, entry.section, entry.declaration, entry.context])}`
      : `crates:invalid:${entry.name}`;
  }
  invalidate(): void {
    this.workspace.invalidate();
    this.client.invalidate();
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
    const manifest = parseManifest(document.getText(), document.uri);
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
      const read = await this.workspace.read(joinUriPath(root.uri, "..", "Cargo.lock"));
      if (read.kind === "found") {
        const selection = selectLocked(read.text, spec.name, requirement);
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
