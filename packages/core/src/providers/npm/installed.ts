import { parse as parseJsonc } from "jsonc-parser";
import { TtlCache } from "../../ttlCache";
import type { FileSystemLike, UriLike } from "../types";
import { joinUriPath } from "../uri";
import type { NpmManifest } from "./manifest";

/** Remember lookups briefly so typing does not re-read node_modules on every keystroke */
const CACHE_TTL_MS = 15_000;
/** Upper bound so a workspace with many packages and directories cannot grow this without limit */
const MAX_CACHE_ENTRIES = 2000;
/** How far up the directory tree to walk */
const MAX_WALK_UP = 12;

export interface InstalledPackage {
  readonly manifest: NpmManifest;
  readonly uri: UriLike;
}

/**
 * Find a package that is already installed under `node_modules`.

 * Layouts differ per package manager, but **for direct dependencies** they all end up reachable at `<dir>/node_modules/<name>/package.json`:

 * - npm, yarn classic, bun … hoisted real directories.
 * - pnpm … a symlink into `node_modules/.pnpm/…`. Reads follow it transparently, so no special case is needed. pnpm only links direct dependencies at the top level, and direct dependencies are exactly what gets annotated.
 * - yarn berry with `nodeLinker: node-modules` … real directories.
 * - yarn berry in PnP mode … there is no node_modules at all. Nothing is found here and the caller falls back to the lockfile and the registry.

 * Parent directories are searched too, which is what makes hoisting and monorepos work.
 */
export class InstalledPackageLookup {
  private cache = new TtlCache<InstalledPackage | undefined>(CACHE_TTL_MS, MAX_CACHE_ENTRIES);

  constructor(private readonly fs: FileSystemLike) {}

  async find(manifestUri: UriLike, name: string): Promise<InstalledPackage | undefined> {
    const startDir = joinUriPath(manifestUri, "..");
    const cacheKey = `${startDir.toString()}|${name}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached.value;
    }

    let dir = startDir;
    let hit: InstalledPackage | undefined;
    for (let depth = 0; depth < MAX_WALK_UP; depth++) {
      const candidate = joinUriPath(dir, "node_modules", ...name.split("/"), "package.json");
      const manifest = await this.readManifest(candidate);
      if (manifest) {
        hit = { manifest, uri: candidate };
        break;
      }
      const parent = joinUriPath(dir, "..");
      if (parent.path === dir.path) {
        break;
      }
      dir = parent;
    }

    this.cache.set(cacheKey, hit);
    return hit;
  }

  invalidate(): void {
    this.cache.clear();
  }

  private async readManifest(uri: UriLike): Promise<NpmManifest | undefined> {
    try {
      const bytes = await this.fs.readFile(uri);
      return parseJsonc(new TextDecoder("utf-8").decode(bytes)) as NpmManifest;
    } catch {
      // Missing or unreadable simply means "not found"
      return undefined;
    }
  }
}
