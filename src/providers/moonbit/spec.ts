/**
 * What counts as a module name and a version.

 * moon parses a dependency's version with Rust's `semver::Version`, which is an exact release and not a range: the resolver is [minimal version selection](https://github.com/moonbitlang/moon/blob/main/crates/mooncake/src/resolver/mvs.rs), so a declared version is the *lowest* one acceptable and the build only moves past it when another module in the graph asks for more. That is why a declaration is looked up as written, and why what `.mooncakes` actually holds wins over it.
 */

/** SemVer 2.0.0, as published at https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** A module name is `user/module`, in letters, digits, `_` and `-`, and may nest further */
const MODULE_NAME = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)+$/;

export function isModuleVersion(version: string): boolean {
  return SEMVER.test(version);
}

export function isModuleName(name: string): boolean {
  return MODULE_NAME.test(name);
}

/**
 * Whether mooncakes.io can be asked about this module.

 * Its API addresses a module as `/api/v0/modules/<user>/<module>` and answers 404 for anything deeper, even though the registry index does carry nested names such as `moonbitlang/lex/runtime`. Those resolve from the index or from `.mooncakes` instead.
 */
export function isRegistryModuleName(name: string): boolean {
  return isModuleName(name) && name.split("/").length === 2;
}

/** The path a module's files live under, e.g. `.mooncakes/<user>/<module>` */
export function moduleSegments(name: string): string[] {
  return name.split("/");
}
