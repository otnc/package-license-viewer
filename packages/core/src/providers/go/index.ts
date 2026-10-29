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
import { combineLicenses, DepsDevClient, modulePageUrl } from "./client";
import { GoEnvironment } from "./env";
import { GoEntry, isGoModPath, parseGoMod } from "./parse";
import { isModulePath, isModuleVersion } from "./spec";

/**
 * Provider for Go module manifests (`go.mod`).

 * Each `require` is looked up at exactly the version it names, after `replace` directives are applied: a module replaced by another resolves as that other module, and one replaced by a local directory is left un-annotated. Licenses come from deps.dev, since nothing on the Go side publishes them as metadata. Nothing runs `go`, and neither the module cache nor any license file is read.

 * A module matching `GOPRIVATE`, `GONOPROXY` or `GONOSUMDB` is never looked up, so a private module's path does not leave the machine.
 */
export class GoLicenseProvider implements LicenseProvider {
  readonly id = "go";

  private readonly env: GoEnvironment;
  private readonly client: DepsDevClient;

  constructor(
    cache: LicenseCache,
    private readonly host: ProviderHost
  ) {
    this.env = new GoEnvironment(host);
    this.client = new DepsDevClient(cache);
  }

  supports(document: TextDocumentLike): boolean {
    const path = this.host.parseUri(document.uri).path;
    // A dependency's own go.mod, extracted into the module cache as `<path>@<version>/`, is not a project manifest
    return isGoModPath(path) && !/\/[^/]*@v[^/]*\//.test(path);
  }

  isEnabled(): boolean {
    return getSetting("go.enabled", true);
  }

  parse(document: TextDocumentLike): GoEntry[] {
    return parseGoMod(document.getText());
  }

  cacheKey(entry: DependencyEntry): string {
    return entry instanceof GoEntry
      ? `go:${JSON.stringify([entry.name, entry.declaration])}`
      : `go:invalid:${entry.name}`;
  }

  invalidate(): void {
    this.env.invalidate();
    this.client.invalidate();
  }

  async resolve(
    entry: DependencyEntry,
    _document: TextDocumentLike,
    token: CancellationLike
  ): Promise<LicenseInfo> {
    if (!(entry instanceof GoEntry)) {
      return { source: "unknown", detail: "invalid Go entry" };
    }
    const declaration = entry.declaration;
    if (declaration.kind !== "module") {
      return { source: declaration.kind, detail: declaration.reason };
    }
    const { path, version } = declaration;
    if (!isModulePath(path)) {
      return { source: "unknown", detail: "not a public module path" };
    }
    if (!isModuleVersion(version)) {
      return { source: "unknown", detail: "invalid version" };
    }
    if (await this.env.isPrivate(path)) {
      return { source: "skipped", detail: "private module (`GOPRIVATE`)" };
    }

    const via = declaration.replaced ? `\`replace\` → \`${path}\` + deps.dev` : "deps.dev";
    const result = await this.client.version(path, version, token);
    if (result.kind === "unknown") {
      return { source: "unknown", version, via, detail: result.reason };
    }
    const license = combineLicenses(result.module.licenses);
    return {
      source: "registry",
      license,
      version,
      homepage: result.module.sourceRepo,
      packagePageUrl: modulePageUrl(path, version),
      via,
      detail: license ? undefined : describeMissingLicense(result.module.licenses),
    };
  }
}

function describeMissingLicense(licenses: readonly string[]): string {
  return licenses.length > 0
    ? "deps.dev found a license it could not identify"
    : "deps.dev found no license in this module";
}

export { GoEntry, parseGoMod } from "./parse";
