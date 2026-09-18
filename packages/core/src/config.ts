import * as vscode from "vscode";

export const CONFIG_SECTION = "packageLicenseViewer";

export interface ViewerConfig {
  enabled: boolean;
  format: string;
  showResolvedVersion: boolean;
  showNodeEngine: boolean;
  unknownText: string;
  annotationColor: string;
  licenseColor: string;
  margin: string;
  cacheTtlHours: number;
  requestTimeoutMs: number;
  maxConcurrentRequests: number;
}

/**
 * Cache of the unscoped config.

 * getConfig() sits on a hot path — the cache consults it for every lookup and every request does too — so a manifest with hundreds of dependencies would otherwise read the settings thousands of times per pass. Cleared whenever the configuration changes.
 */
let unscopedCache: ViewerConfig | undefined;

export function invalidateConfigCache(): void {
  unscopedCache = undefined;
}

export function getConfig(scope?: vscode.ConfigurationScope): ViewerConfig {
  if (!scope && unscopedCache) {
    return unscopedCache;
  }
  const config = readConfig(scope);
  if (!scope) {
    unscopedCache = config;
  }
  return config;
}

function readConfig(scope?: vscode.ConfigurationScope): ViewerConfig {
  const c = vscode.workspace.getConfiguration(CONFIG_SECTION, scope);
  return {
    enabled: c.get<boolean>("enabled", true),
    format: c.get<string>("format", "${license}"),
    showResolvedVersion: c.get<boolean>("showResolvedVersion", false),
    showNodeEngine: c.get<boolean>("showNodeEngine", true),
    unknownText: c.get<string>("unknownText", ""),
    annotationColor: c.get<string>("annotationColor", "editorCodeLens.foreground"),
    licenseColor: c.get<string>("licenseColor", "charts.green"),
    margin: c.get<string>("margin", "0 0 0 1.5em"),
    cacheTtlHours: c.get<number>("cacheTtlHours", 168),
    requestTimeoutMs: c.get<number>("requestTimeoutMs", 8000),
    maxConcurrentRequests: c.get<number>("maxConcurrentRequests", 8),
  };
}

/** Small helper for reading a single `packageLicenseViewer.<key>` setting */
export function getSetting<T>(key: string, defaultValue: T, scope?: vscode.ConfigurationScope): T {
  return vscode.workspace.getConfiguration(CONFIG_SECTION, scope).get<T>(key, defaultValue);
}
