/** The parts of a package.json this extension cares about */
export interface NpmManifest {
  name?: string;
  version?: string;
  license?: string | { type?: string; url?: string };
  /** Deprecated, but still present in older packages */
  licenses?: Array<string | { type?: string; url?: string }>;
  homepage?: string;
  deprecated?: string;
  private?: boolean;
  engines?: { node?: string };
}

/**
 * Flatten every historical shape of the license field into one string:
 * - `"MIT"`
 * - `{ "type": "MIT", "url": "..." }` (legacy)
 * - `[{ "type": "MIT" }, { "type": "Apache-2.0" }]` (legacy, several)
 */
export function normalizeLicense(manifest: NpmManifest | undefined): string | undefined {
  if (!manifest) {
    return undefined;
  }

  const single = toLicenseString(manifest.license);
  if (single) {
    return single;
  }

  if (Array.isArray(manifest.licenses)) {
    const parts = manifest.licenses.map(toLicenseString).filter((v): v is string => !!v);
    if (parts.length === 1) {
      return parts[0];
    }
    if (parts.length > 1) {
      return `(${parts.join(" OR ")})`;
    }
  }

  return undefined;
}

/** The `engines.node` range, e.g. `">=18.0.0"`, or undefined when the package doesn't declare one */
export function normalizeNodeEngine(manifest: NpmManifest | undefined): string | undefined {
  return trimToUndefined(manifest?.engines?.node);
}

function toLicenseString(
  value: string | { type?: string; url?: string } | undefined
): string | undefined {
  if (typeof value === "string") {
    return trimToUndefined(value);
  }
  if (value && typeof value === "object" && typeof value.type === "string") {
    return trimToUndefined(value.type);
  }
  return undefined;
}

/** Trim a possibly-absent string, treating whitespace-only as absent too */
function trimToUndefined(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
