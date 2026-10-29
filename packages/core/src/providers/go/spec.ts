/**
 * What counts as a module path and a version in `go.mod`.

 * A required version is an exact one, never a range: the go command resolves with minimal version selection, and since Go 1.17 `go mod tidy` writes every module the build needs into the main module's `go.mod` at the version it selected. That is why a declaration is looked up exactly as written.
 */

/**
 * A canonical module version: `v` plus SemVer, with no build metadata other than `+incompatible`.

 * Pseudo-versions such as `v0.0.0-20231006140011-7918f672742d` are ordinary prerelease versions under this rule, which is exactly how the go command treats them too.
 */
const MODULE_VERSION =
  /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+incompatible)?$/;

/** Path elements are ASCII letters, digits and `-._~`, and neither start nor end with a dot */
const PATH_ELEMENT = /^[A-Za-z0-9_~-](?:[A-Za-z0-9._~-]*[A-Za-z0-9_~-])?$/;

export function isModuleVersion(version: string): boolean {
  return MODULE_VERSION.test(version);
}

/**
 * Whether this is a module path the public module mirror could serve.

 * Mirrors the parts of `module.CheckPath` that matter here: every element is well formed, and the first one is a lowercase host name with a dot in it — which is also what tells a real module apart from a standard-library or otherwise local-only path.
 */
export function isModulePath(path: string): boolean {
  const elements = path.split("/");
  const host = elements[0];
  return (
    elements.every((element) => PATH_ELEMENT.test(element)) &&
    host.includes(".") &&
    host === host.toLowerCase() &&
    !host.startsWith("-")
  );
}

/**
 * Whether a `replace` target is a directory on disk rather than a module path — the same test `modfile.IsDirectoryPath` applies.
 */
export function isDirectoryPath(target: string): boolean {
  return (
    target.startsWith("./") ||
    target.startsWith("../") ||
    target.startsWith("/") ||
    target.startsWith(".\\") ||
    target.startsWith("..\\") ||
    target.startsWith("\\") ||
    target === "." ||
    target === ".." ||
    /^[A-Za-z]:/.test(target)
  );
}
