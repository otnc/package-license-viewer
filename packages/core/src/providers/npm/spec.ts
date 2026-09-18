import semver from "semver";

export type NpmSpecKind =
  /** A semver range, resolvable against the registry */
  | "range"
  /** A dist-tag such as `latest` or `next` */
  | "tag"
  /**
   * A JSR package (`jsr:<range>` or `jsr:@scope/name@<range>`, as written by pnpm >=10.9 and Yarn >=4.9), resolved against jsr.io instead of the npm registry
   */
  | "jsr"
  /**
   * A pnpm workspace catalog reference (`catalog:` or `catalog:<name>`). The registry has no way to answer this — the actual version lives in the workspace's `pnpm-workspace.yaml` — but `pnpm-lock.yaml` records the specifier verbatim next to the version it resolved to, so the lockfile can still answer it.
   */
  | "catalog"
  /** A local path, workspace link, git or tarball reference — not resolvable this way */
  | "unresolvable";

export interface ParsedSpec {
  readonly kind: NpmSpecKind;
  /** The package to actually ask about — for an alias or a `jsr:` specifier, the real target */
  readonly name: string;
  /** The specifier to actually resolve */
  readonly spec: string;
  /** Why it is unresolvable */
  readonly reason?: string;
}

const PROTOCOL_REASONS: ReadonlyArray<readonly [string, string]> = [
  ["file:", "local path dependency"],
  ["link:", "linked dependency"],
  ["portal:", "portal dependency"],
  ["workspace:", "workspace dependency"],
  ["patch:", "patched dependency"],
  ["git:", "git dependency"],
  ["git+", "git dependency"],
  ["github:", "git dependency"],
  ["gitlab:", "git dependency"],
  ["bitbucket:", "git dependency"],
  ["http:", "remote tarball"],
  ["https:", "remote tarball"],
];

/**
 * Classify a package.json version specifier, so specifiers that the registry could never answer are ruled out before any request is made.
 */
export function parseSpec(name: string, rawSpec: string): ParsedSpec {
  const spec = rawSpec.trim();

  // An alias (`npm:other-pkg@^1.0.0`) is resolved as its target
  if (spec.startsWith("npm:")) {
    const rest = spec.slice("npm:".length);
    const at = rest.lastIndexOf("@");
    // Do not mistake the leading `@` of a scoped name for the separator
    const aliasName = at > 0 ? rest.slice(0, at) : rest;
    const aliasSpec = at > 0 ? rest.slice(at + 1) : "*";
    return classify(aliasName, aliasSpec);
  }

  // pnpm >=10.9 and Yarn >=4.9 install JSR packages with a `jsr:` specifier instead of the `@jsr/scope__name` npm-compatibility alias. Two shapes appear in the wild:
  //   "@luca/cases": "jsr:^1.0.0"              — bare range, the key IS the JSR name
  //   "cases-alias": "jsr:@luca/cases@^1.0.0"  — aliased, the JSR name is in the value
  if (spec.startsWith("jsr:")) {
    const rest = spec.slice("jsr:".length);
    if (rest.startsWith("@")) {
      const at = rest.lastIndexOf("@");
      const jsrName = at > 0 ? rest.slice(0, at) : rest;
      const range = at > 0 ? rest.slice(at + 1) : "";
      return { kind: "jsr", name: jsrName, spec: range.length > 0 ? range : "latest" };
    }
    return { kind: "jsr", name, spec: rest.length > 0 ? rest : "latest" };
  }

  // pnpm workspace catalogs (`"catalog:"` for the default catalog, `"catalog:name"` for a named one) are written verbatim into package.json. There is no version here to resolve against a registry — only the lockfile's `importers` section, which pins the specifier to the version the catalog resolved to at install time.
  if (spec.startsWith("catalog:")) {
    return { kind: "catalog", name, spec };
  }

  for (const [prefix, reason] of PROTOCOL_REASONS) {
    if (spec.toLowerCase().startsWith(prefix)) {
      return { kind: "unresolvable", name, spec, reason };
    }
  }

  // The `user/repo` GitHub shorthand
  if (/^[\w.-]+\/[\w.-]+(#.+)?$/.test(spec) && !spec.startsWith("@")) {
    return { kind: "unresolvable", name, spec, reason: "git dependency" };
  }

  return classify(name, spec);
}

function classify(name: string, spec: string): ParsedSpec {
  if (spec === "" || spec === "*" || spec === "x" || spec === "latest") {
    return { kind: "tag", name, spec: "latest" };
  }
  if (semver.validRange(spec, { loose: true })) {
    return { kind: "range", name, spec };
  }
  // Anything left that looks like a word is treated as a dist-tag (`next`, `beta`, …)
  if (/^[a-z][\w.-]*$/i.test(spec)) {
    return { kind: "tag", name, spec };
  }
  return { kind: "unresolvable", name, spec, reason: "unsupported version specifier" };
}

/** Encode a package name for a registry URL (`@scope/name` becomes `@scope%2fname`) */
export function encodePackageName(name: string): string {
  return name.startsWith("@") ? name.replace("/", "%2f") : encodeURIComponent(name);
}
