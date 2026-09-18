import * as vscode from "vscode";
import semver from "semver";
import type { LicenseCache } from "../../cache";
import { getSetting } from "../../config";
import { log } from "../../log";
import {
  JsrClient,
  parseJsrNpmCompatName,
  parseJsrPackageName,
  resolveViaNpmRegistry,
} from "../jsr";
import type {
  CancellationLike,
  DependencyEntry,
  LicenseInfo,
  LicenseProvider,
  TextDocumentLike,
} from "../types";
import { InstalledPackageLookup } from "./installed";
import { LockfileResolver } from "./lockfile";
import { normalizeLicense, normalizeNodeEngine } from "./manifest";
import { parsePackageJson } from "./parse";
import { parsePnpmWorkspaceYaml } from "./pnpmWorkspace";
import { NpmRegistryClient } from "./registry";
import { parseSpec } from "./spec";

const DEFAULT_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/**
 * Provider for package.json.

 * Resolution order:
 *  1. node_modules — what is actually installed. Offline, instant, and the most trustworthy.
 *  2. the lockfile — the pinned version even under PnP or before installing. npm's lockfile carries the license too.
 *  3. the registry — resolve the specifier's range as a last resort.

 * JSR packages are a cross-cutting exception to that: whether they show up as the npm compatibility alias `@jsr/scope__name` or as a native `jsr:<range>` specifier (pnpm >=10.9, Yarn >=4.9), the license always has to come from jsr.io — the npm-compatibility layer's package.json never carries a `license` field, installed or not.

 * A pnpm workspace catalog reference (`catalog:`, `catalog:<name>`) skips step 3 entirely: there is no version in the manifest for the registry to resolve, only in `pnpm-workspace.yaml`, so once the lockfile lookup in step 2 comes up empty there is nothing left to try.

 * `pnpm-workspace.yaml` itself is also understood, separately from package.json: its `catalog:` and `catalogs:` sections list the actual ranges a catalog reference resolves to, so those get annotated exactly like a normal dependency — the three resolution steps above apply unchanged.
 */
export class NpmLicenseProvider implements LicenseProvider {
  readonly id = "npm";

  private readonly installed = new InstalledPackageLookup();
  private readonly lockfiles = new LockfileResolver();
  private readonly registry: NpmRegistryClient;
  private readonly jsr: JsrClient;

  constructor(cache: LicenseCache) {
    this.registry = new NpmRegistryClient(cache);
    this.jsr = new JsrClient(cache);
  }

  supports(document: TextDocumentLike): boolean {
    const path = vscode.Uri.parse(document.uri).path;
    if (path.endsWith("/package.json")) {
      // Never annotate a package.json that lives inside node_modules
      return !path.includes("/node_modules/");
    }
    if (path.endsWith("/pnpm-workspace.yaml") || path.endsWith("/pnpm-workspace.yml")) {
      return getSetting("npm.pnpmWorkspaceCatalogs", true);
    }
    return false;
  }

  isEnabled(): boolean {
    return getSetting("npm.enabled", true);
  }

  parse(document: TextDocumentLike): DependencyEntry[] {
    const path = vscode.Uri.parse(document.uri).path;
    if (path.endsWith("/pnpm-workspace.yaml") || path.endsWith("/pnpm-workspace.yml")) {
      return parsePnpmWorkspaceYaml(document);
    }
    return parsePackageJson(document, {
      sections: getSetting<string[]>("npm.sections", DEFAULT_SECTIONS),
      autoDetectSections: getSetting("npm.autoDetectSections", true),
    });
  }

  cacheKey(entry: DependencyEntry): string {
    return `${this.id}:${entry.name}@${entry.spec}`;
  }

  invalidate(): void {
    this.installed.invalidate();
    this.lockfiles.invalidate();
  }

  async resolve(
    entry: DependencyEntry,
    document: TextDocumentLike,
    token: CancellationLike
  ): Promise<LicenseInfo> {
    const uri = vscode.Uri.parse(document.uri);
    const parsed = parseSpec(entry.name, entry.spec);

    // JSR-flavored dependencies show up two ways in a package.json:
    //  - the npm-compatibility alias name npm, yarn classic and bun get when installed through
    //    the `@jsr` scoped registry: `"@jsr/scope__name": "^1.0.0"`
    //  - the native specifier pnpm >=10.9 and Yarn >=4.9 write directly:
    //    `"@scope/name": "jsr:^1.0.0"` or `"alias": "jsr:@scope/name@^1.0.0"`
    // Either way jsr.io has to be asked, not npmjs.org — it has never heard of these packages.
    const jsrId =
      parseJsrNpmCompatName(parsed.name) ??
      (parsed.kind === "jsr" ? parseJsrPackageName(parsed.name) : undefined);

    // 1. Whatever is installed wins
    const local = await this.installed.find(uri, entry.name);
    if (local) {
      const version = local.manifest.version;
      const satisfies =
        parsed.kind !== "range" ||
        !version ||
        semver.satisfies(version, parsed.spec, { loose: true, includePrerelease: true });
      if (satisfies) {
        const license = normalizeLicense(local.manifest);
        const nodeEngine = normalizeNodeEngine(local.manifest);
        // Only a genuine, alias-resolved semver specifier is guaranteed to name a real npmjs.org package — not a JSR package (jsrId), and not a file:/workspace:/git dependency that merely happens to be linked locally. A catalog reference names a real npm package too, its version just comes from the workspace catalog.
        const registryPackageName =
          !jsrId && (parsed.kind === "range" || parsed.kind === "tag" || parsed.kind === "catalog")
            ? parsed.name
            : undefined;
        if (license) {
          return {
            license,
            version,
            source: "local",
            homepage: local.manifest.homepage,
            nodeEngine,
            registryPackageName,
          };
        }
        if (jsrId && version) {
          // The package.json inside node_modules never carries a license field for a JSR package (true even for packages that do declare one on JSR), so ask jsr.io for the license of the exact version that is already on disk.
          const jsrLicense = await this.jsr.fetchLicense(jsrId, version, token);
          const packagePage = this.jsr.packageUrl(jsrId, version);
          return {
            license: jsrLicense,
            version,
            source: "local",
            via: "node_modules + jsr.io",
            // Prefer the JSR page over whatever homepage node_modules happened to record — consistent with what a full JSR resolution returns, and it's what the hover title links to.
            homepage: packagePage,
            packagePageUrl: packagePage,
            nodeEngine,
            detail: jsrLicense ? undefined : "the package declares no license on JSR",
          };
        }
        return {
          version,
          source: "local",
          homepage: local.manifest.homepage,
          nodeEngine,
          registryPackageName,
          detail: "no license field in the installed package.json",
        };
      }
      log.debug(`npm: installed ${entry.name}@${version} does not satisfy ${entry.spec}`);
    }

    if (parsed.kind === "jsr" && !jsrId) {
      return { source: "skipped", detail: "JSR packages must be scoped (@scope/name)" };
    }
    if (jsrId) {
      return this.jsr.resolve(jsrId, parsed.spec, token);
    }

    if (parsed.kind === "unresolvable") {
      return { source: "skipped", detail: parsed.reason };
    }

    // 2. Ask the lockfile for the pinned version
    if (getSetting("npm.useLockfiles", true)) {
      const locked = await this.lockfiles.lookup(uri, parsed.name, parsed.spec);
      if (locked) {
        // npm's lockfile has the license, so this can be answered outright
        if (locked.license) {
          return {
            license: locked.license,
            version: locked.version,
            source: "lockfile",
            via: `\`${lockfileName(locked.kind)}\``,
            registryPackageName: parsed.name,
          };
        }
        if (getSetting("npm.useRegistry", true)) {
          const info = await this.fetchExactVersion(parsed.name, locked.version, token);
          if (info) {
            return { ...info, via: `\`${lockfileName(locked.kind)}\` + registry` };
          }
        }
        return {
          version: locked.version,
          source: "lockfile",
          via: `\`${lockfileName(locked.kind)}\``,
          registryPackageName: parsed.name,
          detail: "the lockfile pins a version but carries no license",
        };
      }
    }

    // A catalog reference has no version of its own — only pnpm-lock.yaml's importers section records what it resolved to — so there is nothing left for the registry to resolve once the lockfile lookup above has come up empty.
    if (parsed.kind === "catalog") {
      return {
        source: "unknown",
        detail: getSetting("npm.useLockfiles", true)
          ? "no matching entry in pnpm-lock.yaml for this workspace catalog reference"
          : "not installed and lockfile lookups are disabled",
      };
    }

    if (!getSetting("npm.useRegistry", true)) {
      return { source: "unknown", detail: "not installed and registry lookups are disabled" };
    }

    // 3. Resolve the range against the registry
    return resolveViaNpmRegistry(this.registry, parsed.name, parsed.spec, token);
  }

  /** Fetch just the license of the version the lockfile pinned */
  private async fetchExactVersion(
    name: string,
    version: string,
    token: CancellationLike
  ): Promise<LicenseInfo | undefined> {
    try {
      const { license, homepage, nodeEngine } = await this.registry.fetchLicense(
        name,
        version,
        token
      );
      return {
        license,
        version,
        source: license ? "registry" : "lockfile",
        homepage,
        nodeEngine,
        registryPackageName: name,
        detail: license ? undefined : "the published package declares no license",
      };
    } catch (error) {
      log.warn(`npm: failed to fetch ${name}@${version}: ${String(error)}`);
      return undefined;
    }
  }
}

function lockfileName(kind: string): string {
  switch (kind) {
    case "npm":
      return "package-lock.json";
    case "pnpm":
      return "pnpm-lock.yaml";
    case "yarn":
    case "yarn-berry":
      return "yarn.lock";
    case "bun":
      return "bun.lock";
    default:
      return kind;
  }
}
