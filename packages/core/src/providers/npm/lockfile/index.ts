import { log } from "../../../log";
import type { FileSystemLike, UriLike } from "../../types";
import { joinUriPath } from "../../uri";
import {
  type LockEntry,
  type LockIndex,
  type LockfileKind,
  lookupInIndex,
  parseBunLock,
  parseNpmLock,
  parsePnpmLock,
  parseYarnLock,
} from "./parsers";

export type { LockEntry, LockfileKind } from "./parsers";

/** How long a parsed lockfile is reused before being read again */
const CACHE_TTL_MS = 60_000;
/** How far up the directory tree to walk */
const MAX_WALK_UP = 12;
/** Refuse to read lockfiles larger than this (32MB) */
const MAX_SIZE_BYTES = 32 * 1024 * 1024;

type Parser = (text: string) => LockIndex;

/** Lockfiles to look for in a directory, and how to read them. Earlier entries win. */
const LOCKFILES: ReadonlyArray<readonly [string, Parser]> = [
  ["package-lock.json", parseNpmLock],
  ["npm-shrinkwrap.json", parseNpmLock],
  ["pnpm-lock.yaml", parsePnpmLock],
  ["yarn.lock", parseYarnLock],
  ["bun.lock", parseBunLock],
  // bun.lockb is a binary format and cannot be read. bun writes a node_modules tree, so the installed-package path covers that case instead.
];

export interface LockfileHit extends LockEntry {
  readonly kind: LockfileKind;
}

/**
 * Look up the pinned version of a dependency in whichever lockfile sits near the manifest.

 * This matters for:
 *  - Yarn PnP, where there is no node_modules at all
 *  - freshly cloned or CI workspaces where nothing has been installed yet
 *  - ranges whose newest match differs from the version actually pinned

 * npm's lockfile also stores the license, in which case no network access is needed.
 */
export class LockfileResolver {
  private cache = new Map<string, { at: number; indexes: LockIndex[] }>();

  constructor(private readonly fs: FileSystemLike) {}

  async lookup(manifestUri: UriLike, name: string, spec: string): Promise<LockfileHit | undefined> {
    for (const index of await this.load(manifestUri)) {
      const entry = lookupInIndex(index, name, spec);
      if (entry) {
        return { ...entry, kind: index.kind };
      }
    }
    return undefined;
  }

  private async load(manifestUri: UriLike): Promise<LockIndex[]> {
    const startDir = joinUriPath(manifestUri, "..");
    const cacheKey = startDir.toString();
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.indexes;
    }

    const indexes = await this.discover(startDir);
    this.cache.set(cacheKey, { at: Date.now(), indexes });
    return indexes;
  }

  /** Find the nearest directory holding a lockfile and read everything in it */
  private async discover(startDir: UriLike): Promise<LockIndex[]> {
    let dir = startDir;
    for (let depth = 0; depth < MAX_WALK_UP; depth++) {
      // The candidates are unrelated files, so reading them in parallel is safe — "earlier
      // entries win" only has to hold for the *order* of `found`, which Promise.all preserves
      // regardless of which read actually finishes first.
      const reads = await Promise.all(
        LOCKFILES.map(async ([fileName, parse]) => {
          const uri = joinUriPath(dir, fileName);
          const text = await this.readTextFile(uri);
          if (text === undefined) {
            return undefined;
          }
          try {
            const index = parse(text);
            return index.exact.size > 0 || index.byName.size > 0 ? index : undefined;
          } catch (error) {
            log.warn(`lockfile: failed to parse ${uri.path}: ${String(error)}`);
            return undefined;
          }
        })
      );
      const found = reads.filter((index): index is LockIndex => index !== undefined);
      if (found.length > 0) {
        log.debug(`lockfile: using ${found.map((i) => i.kind).join(", ")} from ${dir.path}`);
        return found;
      }

      const parent = joinUriPath(dir, "..");
      if (parent.path === dir.path) {
        break;
      }
      dir = parent;
    }
    return [];
  }

  invalidate(): void {
    this.cache.clear();
  }

  private async readTextFile(uri: UriLike): Promise<string | undefined> {
    try {
      const stat = await this.fs.stat(uri);
      if (stat.size > MAX_SIZE_BYTES) {
        log.warn(`lockfile: skipping ${uri.path} (${stat.size} bytes)`);
        return undefined;
      }
      const bytes = await this.fs.readFile(uri);
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      return undefined;
    }
  }
}
