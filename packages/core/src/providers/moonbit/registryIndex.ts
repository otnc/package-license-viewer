import * as os from "node:os";
import * as path from "node:path";
import semver from "semver";
import type { ProviderHost } from "../types";
import { fileUriFromPath, joinUriPath } from "../uri";
import { normalizeLicense, readText } from "./installed";
import { isModuleVersion, moduleSegments } from "./spec";

/** Remember a parsed index file briefly; one file holds every version of one module */
const CACHE_TTL_MS = 30_000;

/** One published release, as the registry index records it */
export interface IndexedRelease {
  readonly version: string;
  readonly license?: string;
  readonly repository?: string;
}

/**
 * The registry index moon keeps on disk.

 * `moon update` clones https://mooncakes.io/git/index into `$MOON_HOME/registry/index`, one file per module holding one JSON object per published version — including that version's `license`. Every MoonBit toolchain therefore already carries the answer for every version of every module it has ever heard of, which is what makes annotations work offline and without asking mooncakes.io at all.

 * It is a mirror, so it is only as fresh as the last `moon update`; a module or version it has never seen simply misses and the lookup falls through to the registry.
 */
export class RegistryIndex {
  private entries = new Map<string, { at: number; releases: Promise<IndexedRelease[]> }>();

  constructor(private readonly host: ProviderHost) {}

  /**
   * The release matching `version`, or the newest one when no version is asked for.
   * Undefined when the index has nothing to say about this module.
   */
  async lookup(name: string, version: string | undefined): Promise<IndexedRelease | undefined> {
    const releases = await this.releases(name);
    if (releases.length === 0) {
      return undefined;
    }
    if (version !== undefined) {
      return releases.find((release) => release.version === version);
    }
    return releases.reduce((newest, release) =>
      semver.gt(release.version, newest.version) ? release : newest
    );
  }

  invalidate(): void {
    this.entries.clear();
  }

  private releases(name: string): Promise<IndexedRelease[]> {
    const cached = this.entries.get(name);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.releases;
    }
    const releases = this.read(name);
    this.entries.set(name, { at: Date.now(), releases });
    return releases;
  }

  private async read(name: string): Promise<IndexedRelease[]> {
    const home = this.moonHome();
    if (!home) {
      return [];
    }
    const file = joinUriPath(
      home,
      "registry",
      "index",
      "user",
      ...withIndexSuffix(moduleSegments(name))
    );
    const text = await readText(this.host.fs, file);
    return text === undefined ? [] : parseIndex(text, name);
  }

  /**
   * Where the toolchain keeps its registry index and downloads.
   * `MOON_HOME` overrides it; otherwise moon uses `~/.moon`.
   */
  private moonHome() {
    const configured = process.env.MOON_HOME?.trim();
    if (configured) {
      return this.host.parseUri(fileUriFromPath(configured));
    }
    const home = os.homedir();
    return home ? this.host.parseUri(fileUriFromPath(path.join(home, ".moon"))) : undefined;
  }
}

/** The index names a module's file after its last segment, e.g. `user/moonbitlang/x.index` */
function withIndexSuffix(segments: readonly string[]): string[] {
  const parts = [...segments];
  parts[parts.length - 1] = `${parts[parts.length - 1]}.index`;
  return parts;
}

/**
 * Read one index file: JSON lines, oldest release first.

 * A malformed line is dropped on its own rather than discarding the whole file — the same reasoning the crates.io client applies to a single bad version record.
 */
export function parseIndex(text: string, name: string): IndexedRelease[] {
  const releases: IndexedRelease[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    if (record.name !== name) continue;
    if (typeof record.version !== "string" || !isModuleVersion(record.version)) continue;
    releases.push({
      version: record.version,
      license: normalizeLicense(record.license),
      repository: typeof record.repository === "string" ? record.repository : undefined,
    });
  }
  return releases;
}
