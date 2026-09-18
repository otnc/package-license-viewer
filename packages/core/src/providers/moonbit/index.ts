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
import { MooncakesClient, modulePageUrl } from "./client";
import { MooncakesLookup, type ModuleManifest } from "./installed";
import { manifestFormat, MoonbitEntry, parseManifest } from "./parse";
import { RegistryIndex, type IndexedRelease } from "./registryIndex";
import { isModuleName, isModuleVersion, isRegistryModuleName } from "./spec";

/**
 * Provider for MoonBit module manifests.

 * moon is in the middle of replacing `moon.mod.json` with `moon.mod`, a small DSL that writes the same dependencies as `import { "user/module@version" }`. Both are read, because published modules and existing projects still carry the JSON one.

 * Resolution order:
 *  1. `.mooncakes` — what `moon build` actually unpacked, manifest and license included. Offline and authoritative: moon resolves with minimal version selection, so the version in the manifest is a floor and only this says where the build landed.
 *  2. `moon.work` — a member of the workspace is built from its directory in the repository and the `@version` beside it is ignored, so nothing is looked up for it at all.
 *  3. The registry index — `$MOON_HOME/registry/index`, the clone `moon update` maintains. It records every published version's license, so an installed toolchain answers for any version without a single request.
 *  4. mooncakes.io — one request per module for the exact declared version.

 * Path and git dependencies are left un-annotated: mooncakes.io knows nothing about either.
 */
export class MoonbitLicenseProvider implements LicenseProvider {
  readonly id = "moonbit";

  private readonly lookup: MooncakesLookup;
  private readonly index: RegistryIndex;
  private readonly client: MooncakesClient;

  constructor(
    cache: LicenseCache,
    private readonly host: ProviderHost
  ) {
    this.lookup = new MooncakesLookup(host.fs);
    this.index = new RegistryIndex(host);
    this.client = new MooncakesClient(cache);
  }

  supports(document: TextDocumentLike): boolean {
    const path = this.host.parseUri(document.uri).path;
    // A dependency's own manifest, unpacked under .mooncakes, is not a project manifest
    return manifestFormat(path) !== undefined && !path.includes("/.mooncakes/");
  }

  isEnabled(): boolean {
    return getSetting("moonbit.enabled", true);
  }

  parse(document: TextDocumentLike): MoonbitEntry[] {
    const format = manifestFormat(this.host.parseUri(document.uri).path);
    if (!format) return [];
    return parseManifest(document.getText(), document.uri, format).entries;
  }

  cacheKey(entry: DependencyEntry): string {
    return entry instanceof MoonbitEntry
      ? `moonbit:${JSON.stringify([entry.manifestUri, entry.name, entry.section, entry.declaration])}`
      : `moonbit:invalid:${entry.name}`;
  }

  invalidate(): void {
    this.lookup.invalidate();
    this.index.invalidate();
    this.client.invalidate();
  }

  async resolve(
    entry: DependencyEntry,
    document: TextDocumentLike,
    token: CancellationLike
  ): Promise<LicenseInfo> {
    if (!(entry instanceof MoonbitEntry)) {
      return { source: "unknown", detail: "invalid MoonBit entry" };
    }
    const declaration = entry.declaration;
    if (declaration.kind === "skipped" || declaration.kind === "unknown") {
      return { source: declaration.kind, detail: declaration.reason };
    }
    if (!isModuleName(entry.name)) {
      return { source: "unknown", detail: "invalid module name" };
    }

    const manifestUri = this.host.parseUri(document.uri);
    const installed = await this.lookup.find(manifestUri, entry.name);
    if (installed?.version) {
      return fromInstalled(entry.name, installed);
    }

    if (await this.lookup.isWorkspaceMember(manifestUri, entry.name)) {
      return { source: "skipped", detail: "built from a `moon.work` member" };
    }

    // Only the lookups below read the declared version, so it is checked here rather
    // than up front: what is on disk answers first, and a moon.work member's `@version`
    // is ignored by moon whatever it says.
    if (declaration.version !== undefined && !isModuleVersion(declaration.version)) {
      return { source: "unknown", detail: "invalid version" };
    }

    if (getSetting("moonbit.useRegistryIndex", true)) {
      const indexed = await this.index.lookup(entry.name, declaration.version);
      if (indexed) {
        return fromIndex(entry.name, indexed);
      }
    }

    const result = await this.client.release(entry.name, declaration.version, token);
    const via = declaration.version ? "mooncakes.io" : "mooncakes.io (newest release)";
    if (result.kind === "unknown") {
      return { source: "unknown", version: declaration.version, via, detail: result.reason };
    }
    const release = result.release;
    return {
      source: "registry",
      license: release.license,
      version: release.version,
      homepage: homepageOf(release.repository),
      packagePageUrl: modulePageUrl(entry.name, release.version),
      via,
      detail: describeMissingLicense(release.license, release.yanked),
    };
  }
}

function fromInstalled(name: string, installed: ModuleManifest): LicenseInfo {
  const version = installed.version as string;
  return {
    source: "local",
    license: installed.license,
    version,
    homepage: homepageOf(installed.repository),
    packagePageUrl: pageUrl(name, version),
    via: "unpacked module (`.mooncakes`)",
    detail: installed.license ? undefined : "the unpacked module declares no license",
  };
}

function fromIndex(name: string, indexed: IndexedRelease): LicenseInfo {
  return {
    source: "registry",
    license: indexed.license,
    version: indexed.version,
    homepage: homepageOf(indexed.repository),
    packagePageUrl: pageUrl(name, indexed.version),
    via: "local registry index (`moon update`)",
    detail: indexed.license ? undefined : "the published module declares no license",
  };
}

/**
 * The hover title only gets a link when mooncakes.io really has a page for the module.

 * Its web app reads `/api/v0/manifest/<user>/<module>`, which has no route for a nested name such as `moonbitlang/lex/runtime` even though the registry index carries it — so linking one of those would hand the reader a page that cannot load. An unpacked module whose manifest states a version the registry could never have published gets no link either.
 */
function pageUrl(name: string, version: string): string | undefined {
  return isRegistryModuleName(name) && isModuleVersion(version)
    ? modulePageUrl(name, version)
    : undefined;
}

function describeMissingLicense(license: string | undefined, yanked: boolean): string | undefined {
  if (license) return undefined;
  return yanked
    ? "this version is yanked and declares no license"
    : "the published module declares no license";
}

/** `repository` is free text in a module manifest; only link it when it really is a URL */
function homepageOf(repository: string | undefined): string | undefined {
  return repository && /^https?:\/\//i.test(repository) ? repository : undefined;
}

export { MoonbitEntry, parseManifest } from "./parse";
