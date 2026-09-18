import { parse as parseJsonc } from "jsonc-parser";
import semver from "semver";

export interface LockEntry {
  readonly version: string;
  /** Only npm's lockfile records the license, in which case it can be used directly */
  readonly license?: string;
}

/**
 * An index over one lockfile.

 * - `exact` … keyed by name plus the specifier as written in the manifest. yarn and pnpm record a resolution per specifier, which makes this the most precise lookup.
 * - `byName` … candidates keyed by name only. A lockfile may pin several versions of the same package, so the caller narrows them down with the semver range.
 */
export interface LockIndex {
  readonly kind: LockfileKind;
  readonly exact: Map<string, LockEntry>;
  readonly byName: Map<string, LockEntry[]>;
}

export type LockfileKind = "npm" | "pnpm" | "yarn" | "yarn-berry" | "bun";

export function emptyIndex(kind: LockfileKind): LockIndex {
  return { kind, exact: new Map(), byName: new Map() };
}

/** Look one entry up: exact specifier match first, then narrowing by semver */
export function lookupInIndex(index: LockIndex, name: string, spec: string): LockEntry | undefined {
  const exact = index.exact.get(`${name}@${spec}`);
  if (exact) {
    return exact;
  }

  // A catalog reference isn't a semver range — there is no sound way to narrow several candidates down to "the" one it resolved to, so only the exact importers match above can answer it. Guessing a same-named version pinned elsewhere in the lockfile (a transitive dependency, say) would report a plausible-looking but unrelated version.
  if (spec.startsWith("catalog:")) {
    return undefined;
  }

  const candidates = index.byName.get(name);
  if (!candidates || candidates.length === 0) {
    return undefined;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }

  // Several versions are pinned, so take the highest one the specifier allows
  const versions = candidates.map((entry) => entry.version);
  const best = semver.maxSatisfying(versions, spec, { loose: true, includePrerelease: true });
  return best ? candidates.find((entry) => entry.version === best) : undefined;
}

function push(index: LockIndex, name: string, entry: LockEntry): void {
  const list = index.byName.get(name);
  if (!list) {
    index.byName.set(name, [entry]);
  } else if (!list.some((existing) => existing.version === entry.version)) {
    list.push(entry);
  }
}

// --- npm (package-lock.json / npm-shrinkwrap.json) -------------------------

interface NpmLockPackage {
  version?: string;
  license?: string;
  link?: boolean;
  resolved?: string;
}

interface NpmLock {
  lockfileVersion?: number;
  /** lockfileVersion 2 and later */
  packages?: Record<string, NpmLockPackage>;
  /** lockfileVersion 1, and kept for compatibility in 2 */
  dependencies?: Record<string, NpmLockV1Dependency>;
}

interface NpmLockV1Dependency {
  version?: string;
  dependencies?: Record<string, NpmLockV1Dependency>;
}

/**
 * npm is the only lockfile that also stores the license, so when one is present the whole lookup can happen without touching the network.
 */
export function parseNpmLock(text: string): LockIndex {
  const index = emptyIndex("npm");
  const lock = parseJsonc(text) as NpmLock | undefined;
  if (!lock) {
    return index;
  }

  for (const [key, value] of Object.entries(lock.packages ?? {})) {
    // The root entry and workspace links are not packages we can read a license from
    if (key === "" || value.link || !value.version) {
      continue;
    }
    const marker = key.lastIndexOf("node_modules/");
    if (marker < 0) {
      continue;
    }
    const name = key.slice(marker + "node_modules/".length);
    if (name.length > 0) {
      push(index, name, { version: value.version, license: value.license });
    }
  }

  // lockfileVersion 1, i.e. npm 6 and earlier
  const walk = (deps: Record<string, NpmLockV1Dependency> | undefined) => {
    for (const [name, value] of Object.entries(deps ?? {})) {
      if (value.version) {
        push(index, name, { version: value.version });
      }
      walk(value.dependencies);
    }
  };
  if (!lock.packages) {
    walk(lock.dependencies);
  }

  return index;
}

// --- bun (bun.lock) --------------------------------------------------------

interface BunLock {
  /** Values look like `["<name>@<version>", registry, meta, integrity]` */
  packages?: Record<string, unknown[]>;
}

/** bun.lock is JSONC with trailing commas, hence jsonc-parser. bun.lockb is not supported. */
export function parseBunLock(text: string): LockIndex {
  const index = emptyIndex("bun");
  const lock = parseJsonc(text) as BunLock | undefined;

  for (const value of Object.values(lock?.packages ?? {})) {
    // Keys become "parent/child" for nested dependencies, so read the name off the descriptor
    const descriptor = Array.isArray(value) ? value[0] : undefined;
    if (typeof descriptor !== "string") {
      continue;
    }
    const parsed = splitNameAndVersion(descriptor);
    if (parsed) {
      push(index, parsed.name, { version: parsed.version });
    }
  }

  return index;
}

// --- yarn (yarn.lock, both classic and berry) ------------------------------

/**
 * Classic and berry both write a heading of comma-separated specifiers followed by a `version` line, so one scan handles both once quoting and the `npm:` protocol are accounted for.
 */
export function parseYarnLock(text: string): LockIndex {
  const isBerry = /^__metadata:/m.test(text);
  const index = emptyIndex(isBerry ? "yarn-berry" : "yarn");

  const lines = text.split(/\r?\n/);
  let heading: string[] = [];

  for (const line of lines) {
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    // Headings are unindented and end with a colon
    if (!/^\s/.test(line)) {
      heading = line.endsWith(":")
        ? line
            .slice(0, -1)
            .split(",")
            .map((part) => part.trim().replace(/^"|"$/g, ""))
            .filter((part) => part.length > 0)
        : [];
      continue;
    }

    if (heading.length === 0) {
      continue;
    }

    // classic: `  version "1.2.3"` — berry: `  version: 1.2.3`
    const match = /^\s+version:?\s+"?([^"\s]+)"?\s*$/.exec(line);
    if (!match) {
      continue;
    }
    const version = match[1];

    for (const descriptor of heading) {
      const parsed = splitNameAndVersion(descriptor);
      if (!parsed) {
        continue;
      }
      const { name, version: rawRange } = parsed;
      // Berry specifiers carry a protocol, as in `npm:^1.0.0`
      const range = rawRange.replace(/^[a-z-]+:/i, "");
      index.exact.set(`${name}@${rawRange}`, { version });
      index.exact.set(`${name}@${range}`, { version });
      push(index, name, { version });
    }
    heading = [];
  }

  return index;
}

// --- pnpm (pnpm-lock.yaml) -------------------------------------------------

/**
 * Read pnpm-lock.yaml without pulling in a YAML parser. Only two parts are needed:
 *  1. `importers`, which maps a specifier to the version it resolved to (most precise)
 *  2. the `packages` / `snapshots` headings, for name and version candidates — read loosely because lockfileVersion 5, 6 and 9 all spell them differently
 */
export function parsePnpmLock(text: string): LockIndex {
  const index = emptyIndex("pnpm");
  const lines = text.split(/\r?\n/);

  let section: "importers" | "packages" | "other" = "other";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) {
      continue;
    }

    // A top-level key switches sections
    if (!/^\s/.test(line)) {
      const key = line.replace(/:.*$/, "").trim();
      section =
        key === "importers"
          ? "importers"
          : key === "packages" || key === "snapshots"
            ? "packages"
            : "other";
      continue;
    }

    if (section === "importers") {
      // `      '@babel/code-frame':` is followed by specifier and version lines
      const nameMatch = /^\s+'?([^'\s:][^':]*?)'?:\s*$/.exec(line);
      if (!nameMatch) {
        continue;
      }
      const name = nameMatch[1];
      let specifier: string | undefined;
      let version: string | undefined;
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const spec = /^\s+specifier:\s*'?(.+?)'?\s*$/.exec(lines[j]);
        const ver = /^\s+version:\s*'?(.+?)'?\s*$/.exec(lines[j]);
        if (spec) {
          specifier = spec[1];
        }
        if (ver) {
          version = stripPeerSuffix(ver[1]);
        }
      }
      if (specifier && version && semver.valid(version, { loose: true })) {
        index.exact.set(`${name}@${specifier}`, { version });
        push(index, name, { version });
      }
      continue;
    }

    if (section === "packages") {
      // v9: `  '@babel/code-frame@7.29.7':`
      // v6: `  /@babel/code-frame@7.29.7:`
      // v5: `  /@babel/code-frame/7.29.7:`
      const headingMatch = /^\s{1,4}'?\/?(.+?)'?:\s*$/.exec(line);
      if (!headingMatch) {
        continue;
      }
      const parsed = splitNameAndVersion(stripPeerSuffix(headingMatch[1]));
      if (parsed && semver.valid(parsed.version, { loose: true })) {
        push(index, parsed.name, { version: parsed.version });
      }
    }
  }

  return index;
}

/** Drop the peer-dependency suffix from something like `1.2.3(react@18.0.0)` */
function stripPeerSuffix(value: string): string {
  const index = value.indexOf("(");
  return (index < 0 ? value : value.slice(0, index)).trim();
}

/**
 * Split `lodash@4.18.1`, `@babel/core@7.0.0` or pnpm v5's `@babel/core/7.0.0`.
 * Splitting on the last `@` avoids mistaking a scope prefix for the separator.
 */
function splitNameAndVersion(descriptor: string): { name: string; version: string } | undefined {
  const at = descriptor.lastIndexOf("@");
  if (at > 0) {
    return { name: descriptor.slice(0, at), version: descriptor.slice(at + 1) };
  }
  // pnpm v5 wrote `/@scope/name/1.2.3`
  const slash = descriptor.lastIndexOf("/");
  if (slash > 0) {
    const version = descriptor.slice(slash + 1);
    if (semver.valid(version, { loose: true })) {
      return { name: descriptor.slice(0, slash), version };
    }
  }
  return undefined;
}
