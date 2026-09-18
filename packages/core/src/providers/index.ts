import type { LicenseCache } from "../cache";
import { CratesLicenseProvider } from "./crates";
import { JsrLicenseProvider } from "./jsr";
import { MoonbitLicenseProvider } from "./moonbit";
import { NpmLicenseProvider } from "./npm";
import type { LicenseProvider, ProviderHost, TextDocumentLike } from "./types";

export * from "./types";
export { CratesLicenseProvider } from "./crates";
export { workspaceManifestUri } from "./crates/workspace";
export { JsrLicenseProvider } from "./jsr";
export { MoonbitLicenseProvider } from "./moonbit";
export { NpmLicenseProvider } from "./npm";

/**
 * Build the set of providers.

 * To support another ecosystem, implement `LicenseProvider` and add it to this array — no other file needs to change. For example:
 *   new PypiLicenseProvider(cache, host)   // requirements.txt / pyproject.toml
 * Remember to add the language to `activationEvents` in package.json as well.
 */
export function createProviders(cache: LicenseCache, host: ProviderHost): LicenseProvider[] {
  return [
    new NpmLicenseProvider(cache, host),
    new JsrLicenseProvider(cache, host),
    new CratesLicenseProvider(cache, host),
    new MoonbitLicenseProvider(cache, host),
  ];
}

/** The first provider that can handle this document, if any */
export function findProvider(
  providers: readonly LicenseProvider[],
  document: TextDocumentLike
): LicenseProvider | undefined {
  return providers.find((provider) => provider.isEnabled() && provider.supports(document));
}
