import { parse as parseJsonc } from "jsonc-parser";
import type { FileSystemLike, UriLike } from "../types";
import { joinUriPath } from "../uri";
import { readStringArrayAssignment, readStringAssignment, tokenize } from "./dsl";
import { manifestFormat, MODULE_MANIFESTS } from "./parse";
import { moduleSegments } from "./spec";

/** Remember lookups briefly so typing does not re-read the filesystem on every keystroke */
const CACHE_TTL_MS = 15_000;
/** How far up the directory tree to walk looking for `.mooncakes` or `moon.work` */
const MAX_WALK_UP = 12;
/** Directory moon unpacks dependencies into, next to the manifest that declares them */
const DEP_PATH = ".mooncakes";

/** The parts of a module manifest that say something about the module itself */
export interface ModuleManifest {
  readonly name?: string;
  readonly version?: string;
  readonly license?: string;
  readonly repository?: string;
}

/**
 * Finds what is on disk for a MoonBit module.

 * Two questions, both answered from the filesystem alone:

 * - **Is it unpacked under `.mooncakes`?** `moon build` puts every resolved dependency there, manifest included, so this is the MoonBit counterpart of reading `node_modules` — instant, offline, and the only source that knows which version minimal version selection actually settled on.
 * - **Is it a `moon.work` member?** Workspace members are built from their directory in the repository, and the `@version` written next to them is ignored. Asking mooncakes.io about one would answer about a different module that merely shares the name, so those are left alone instead.
 */
export class MooncakesLookup {
  private readonly modules = new TimedCache<ModuleManifest | undefined>();
  private readonly workspaces = new TimedCache<ReadonlySet<string>>();

  constructor(private readonly fs: FileSystemLike) {}

  /** The module as it sits in `.mooncakes`, looking in parent directories too */
  find(manifestUri: UriLike, name: string): Promise<ModuleManifest | undefined> {
    const startDir = joinUriPath(manifestUri, "..");
    return this.modules.get(`${startDir.toString()}|${name}`, async () => {
      for (const dir of ancestors(startDir)) {
        const moduleDir = joinUriPath(dir, DEP_PATH, ...moduleSegments(name));
        const manifest = await this.readModuleManifest(moduleDir);
        // A directory of the right name holding an unreadable manifest is not a hit;
        // keep walking rather than reporting the module as unresolvable.
        if (manifest?.version) return manifest;
      }
      return undefined;
    });
  }

  /** Whether a `moon.work` above this manifest builds the module from the repository */
  async isWorkspaceMember(manifestUri: UriLike, name: string): Promise<boolean> {
    const members = await this.members(joinUriPath(manifestUri, ".."));
    return members.has(name);
  }

  invalidate(): void {
    this.modules.clear();
    this.workspaces.clear();
  }

  private members(startDir: UriLike): Promise<ReadonlySet<string>> {
    return this.workspaces.get(startDir.toString(), async () => {
      for (const dir of ancestors(startDir)) {
        const text = await this.readText(joinUriPath(dir, "moon.work"));
        if (text === undefined) continue;
        const paths = readStringArrayAssignment(tokenize(text), "members");
        const names = await Promise.all(
          paths.map(async (member) => {
            // Only plain relative paths; anything else is not ours to interpret.
            if (member.length === 0 || member.startsWith("/") || /^[A-Za-z]:/.test(member)) {
              return undefined;
            }
            const manifest = await this.readModuleManifest(joinUriPath(dir, member));
            return manifest?.name;
          })
        );
        return new Set(names.filter((name): name is string => !!name));
      }
      return new Set<string>();
    });
  }

  /** Read whichever module manifest a directory holds, preferring the newer `moon.mod` */
  private async readModuleManifest(moduleDir: UriLike): Promise<ModuleManifest | undefined> {
    for (const fileName of MODULE_MANIFESTS) {
      const uri = joinUriPath(moduleDir, fileName);
      const text = await readText(this.fs, uri);
      if (text === undefined) continue;
      const manifest = decodeModuleManifest(text, manifestFormat(uri.path) ?? "json");
      if (manifest) return manifest;
    }
    return undefined;
  }

  private readText(uri: UriLike): Promise<string | undefined> {
    return readText(this.fs, uri);
  }
}

/** A missing or unreadable file simply means "not there" */
export async function readText(fs: FileSystemLike, uri: UriLike): Promise<string | undefined> {
  try {
    const bytes = await fs.readFile(uri);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return undefined;
  }
}

/** Short-lived memo of one filesystem answer, so a burst of keystrokes reads the disk once */
class TimedCache<T> {
  private entries = new Map<string, { at: number; value: Promise<T> }>();

  get(key: string, compute: () => Promise<T>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.value;
    }
    const value = compute();
    this.entries.set(key, { at: Date.now(), value });
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}

/** The directory itself and every parent, up to the walk limit or the filesystem root */
function* ancestors(start: UriLike): Generator<UriLike> {
  let dir = start;
  for (let depth = 0; depth < MAX_WALK_UP; depth++) {
    yield dir;
    const parent = joinUriPath(dir, "..");
    if (parent.path === dir.path) return;
    dir = parent;
  }
}

export function decodeModuleManifest(
  text: string,
  format: "dsl" | "json"
): ModuleManifest | undefined {
  if (format === "dsl") {
    const tokens = tokenize(text);
    return {
      name: readStringAssignment(tokens, "name"),
      version: readStringAssignment(tokens, "version"),
      license: normalizeLicense(readStringAssignment(tokens, "license")),
      repository: readStringAssignment(tokens, "repository"),
    };
  }
  let value: unknown;
  try {
    value = parseJsonc(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return {
    name: typeof record.name === "string" ? record.name : undefined,
    version: typeof record.version === "string" ? record.version : undefined,
    license: normalizeLicense(record.license),
    repository: typeof record.repository === "string" ? record.repository : undefined,
  };
}

/** A blank or absent `license` is the same as not declaring one */
export function normalizeLicense(license: unknown): string | undefined {
  return typeof license === "string" && license.trim().length > 0 ? license.trim() : undefined;
}
