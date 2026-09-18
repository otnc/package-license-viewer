import type { LicenseCache } from "../../cache";
import { getSetting } from "../../config";
import { NotFoundError } from "../../net";
import { NpmRegistryClient } from "../npm/registry";
import { parseSpec } from "../npm/spec";
import type {
  CancellationLike,
  DependencyEntry,
  LicenseInfo,
  LicenseProvider,
  ProviderHost,
  TextDocumentLike,
} from "../types";
import { JsrClient, parseJsrPackageName } from "./client";
import { isDenoManifest, parseDenoManifest, parseDenoSpecifier } from "./parse";

export { JsrClient, parseJsrNpmCompatName, parseJsrPackageName } from "./client";

/**
 * Provider for Deno and import-map manifests (`deno.json`, `import_map.json` and friends).
 * Resolves both the `jsr:` and `npm:` specifiers written in `imports`.
 */
export class JsrLicenseProvider implements LicenseProvider {
  readonly id = "jsr";

  private readonly jsr: JsrClient;
  private readonly npm: NpmRegistryClient;

  constructor(
    cache: LicenseCache,
    private readonly host: ProviderHost
  ) {
    this.jsr = new JsrClient(cache);
    this.npm = new NpmRegistryClient(cache);
  }

  supports(document: TextDocumentLike): boolean {
    const uri = this.host.parseUri(document.uri);
    return isDenoManifest(uri) && !uri.path.includes("/node_modules/");
  }

  isEnabled(): boolean {
    return getSetting("jsr.enabled", true);
  }

  parse(document: TextDocumentLike): DependencyEntry[] {
    return parseDenoManifest(document);
  }

  cacheKey(entry: DependencyEntry): string {
    return `${this.id}:${entry.spec}`;
  }

  async resolve(
    entry: DependencyEntry,
    _document: TextDocumentLike,
    token: CancellationLike
  ): Promise<LicenseInfo> {
    const specifier = parseDenoSpecifier(entry.spec);
    if (!specifier) {
      return { source: "skipped", detail: "not a jsr: or npm: specifier" };
    }

    if (specifier.kind === "jsr") {
      const id = parseJsrPackageName(specifier.name);
      if (!id) {
        return { source: "skipped", detail: "JSR packages must be scoped (@scope/name)" };
      }
      return this.jsr.resolve(id, specifier.range, token);
    }

    return resolveViaNpmRegistry(this.npm, specifier.name, specifier.range, token);
  }
}

/**
 * Resolve one package against the npm registry. Shared by Deno's `npm:` specifiers and by the package.json provider.
 */
export async function resolveViaNpmRegistry(
  client: NpmRegistryClient,
  name: string,
  spec: string,
  token: CancellationLike
): Promise<LicenseInfo> {
  const parsed = parseSpec(name, spec);
  // This helper only talks to npmjs.org, so a `jsr:` specifier (which parseSpec also recognises, for the package.json provider's benefit) has no business reaching it.
  if (parsed.kind !== "range" && parsed.kind !== "tag") {
    return {
      source: "skipped",
      detail: parsed.kind === "unresolvable" ? parsed.reason : "not an npm registry specifier",
    };
  }

  try {
    const version = await client.resolveVersion(parsed.name, parsed.spec, parsed.kind, token);
    if (!version) {
      return { source: "unknown", detail: `no published version matches "${spec}"` };
    }
    const { license, homepage, nodeEngine } = await client.fetchLicense(
      parsed.name,
      version,
      token
    );
    return {
      license,
      version,
      source: "registry",
      homepage,
      nodeEngine,
      registryPackageName: parsed.name,
      detail: license ? undefined : "the published package declares no license",
    };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { source: "unknown", detail: "not found in the registry" };
    }
    if (token.isCancellationRequested) {
      return { source: "unknown", detail: "cancelled" };
    }
    return {
      source: "unknown",
      detail: `registry lookup failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
