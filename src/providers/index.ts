import * as vscode from "vscode";
import type { LicenseCache } from "../cache";
import { CratesLicenseProvider } from "./crates";
import { JsrLicenseProvider } from "./jsr";
import { MoonbitLicenseProvider } from "./moonbit";
import { NpmLicenseProvider } from "./npm";
import type { LicenseProvider } from "./types";

export * from "./types";

/**
 * Build the set of providers.

 * To support another ecosystem, implement `LicenseProvider` and add it to this array — no other file needs to change. For example:
 *   new PypiLicenseProvider(cache)   // requirements.txt / pyproject.toml
 * Remember to add the language to `activationEvents` in package.json as well.
 */
export function createProviders(cache: LicenseCache): LicenseProvider[] {
  return [
    new NpmLicenseProvider(cache),
    new JsrLicenseProvider(cache),
    new CratesLicenseProvider(cache),
    new MoonbitLicenseProvider(cache),
  ];
}

/** The first provider that can handle this document, if any */
export function findProvider(
  providers: readonly LicenseProvider[],
  document: vscode.TextDocument
): LicenseProvider | undefined {
  return providers.find((provider) => provider.isEnabled() && provider.supports(document));
}
