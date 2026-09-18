import type { LicenseCache } from "../../cache";
import { getSetting } from "../../config";
import { checkCancelled, fetchJson, NotFoundError, record, RequestLimiter } from "../../net";
import type { CancellationLike } from "../types";
import { normalizeLicense } from "./installed";
import { isModuleVersion, isRegistryModuleName } from "./spec";

/** What mooncakes.io knows about one published release */
export interface MooncakeRelease {
  readonly version: string;
  readonly license?: string;
  readonly repository?: string;
  readonly yanked: boolean;
}

export type ReleaseResult =
  { kind: "found"; release: MooncakeRelease } | { kind: "unknown"; reason: string };

const API = "https://mooncakes.io/api/v0/modules";
/** Smallest gap between two requests leaving this extension host, in milliseconds */
const SEND_SPACING_MS = 250;
/** How long to stand down after the registry answers 429 */
const RATE_LIMIT_BACKOFF_MS = 60_000;

/** The page a module's hover title links to */
export function modulePageUrl(name: string, version: string): string {
  return `https://mooncakes.io/docs/${name}@${version}`;
}

/**
 * Spaces out requests across every MoonBit client in this extension host.

 * mooncakes.io publishes no rate limit, so this stays deliberately gentle rather than filling `maxConcurrentRequests` slots at once against a small community registry, and backs off for a minute without retrying if it ever answers 429.
 */
const limiter = new RequestLimiter(SEND_SPACING_MS, RATE_LIMIT_BACKOFF_MS, () =>
  getSetting("moonbit.useRegistry", true)
);

/**
 * Reads module metadata from mooncakes.io.

 * One request answers everything needed: `/api/v0/modules/<user>/<module>@<version>` returns that exact release's manifest metadata, license included, and the same path without `@<version>` returns the newest release instead. Only exact-version answers are cached, since a module's newest release is by definition the thing that changes.
 */
export class MooncakesClient {
  private epoch = 0;

  constructor(private readonly cache: LicenseCache) {}

  invalidate(): void {
    this.epoch++;
  }

  async release(
    name: string,
    version: string | undefined,
    token: CancellationLike
  ): Promise<ReleaseResult> {
    if (!isRegistryModuleName(name)) {
      return { kind: "unknown", reason: "mooncakes.io only publishes `user/module` names" };
    }
    if (version !== undefined && !isModuleVersion(version)) {
      return { kind: "unknown", reason: "invalid version" };
    }

    const key = version ? `moonbit:release:v1:${name}@${version}` : undefined;
    const cached = key ? this.cache.get<MooncakeRelease>(key) : undefined;
    if (cached) {
      return { kind: "found", release: cached };
    }

    const epoch = this.epoch;
    // Both halves are validated above, and neither alphabet has a character that would
    // need escaping in a path, so the URL is built from them as written.
    const url = version ? `${API}/${name}@${version}` : `${API}/${name}`;
    try {
      checkCancelled(token);
      const json = await limiter.run(token, () => fetchJson<unknown>(url, token));
      const release = decodeRelease(json, name, version);
      checkCancelled(token);
      if (key && epoch === this.epoch) {
        this.cache.set(key, release);
      }
      return { kind: "found", release };
    } catch (error) {
      if (token.isCancellationRequested) {
        return { kind: "unknown", reason: "cancelled" };
      }
      if (error instanceof NotFoundError) {
        return {
          kind: "unknown",
          reason: version ? "mooncakes.io has no such version" : "mooncakes.io has no such module",
        };
      }
      return { kind: "unknown", reason: `mooncakes.io lookup failed: ${String(error)}` };
    }
  }
}

function decodeRelease(
  json: unknown,
  name: string,
  requested: string | undefined
): MooncakeRelease {
  if (!record(json) || json.module !== name || typeof json.version !== "string") {
    throw new Error("invalid mooncakes.io response");
  }
  if (requested !== undefined && json.version !== requested) {
    throw new Error("mooncakes.io returned a different version");
  }
  if (!record(json.metadata) || json.metadata.version !== json.version) {
    throw new Error("invalid mooncakes.io module metadata");
  }
  const metadata = json.metadata;
  return {
    version: json.version,
    license: normalizeLicense(metadata.license),
    repository: typeof metadata.repository === "string" ? metadata.repository : undefined,
    yanked: json.yanked === true,
  };
}
