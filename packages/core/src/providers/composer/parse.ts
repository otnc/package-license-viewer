import { Node, parseTree } from "jsonc-parser";
import type { DependencyEntry, TextDocumentLike } from "../types";
import { Constraint, parseConstraint, Stability } from "./spec";

export class ComposerEntry implements DependencyEntry {
  constructor(
    readonly name: string,
    readonly spec: string,
    readonly section: string,
    readonly line: number,
    /** `UriLike.toString()` of the manifest's directory — the `vendor/` and `composer.lock` it resolves against */
    readonly manifestDir: string,
    readonly constraint: Constraint
  ) {}
}

/** What `resolve()` needs from a composer.json besides its entries */
export interface ComposerManifest {
  readonly entries: ComposerEntry[];
  /** `config.vendor-dir`, default `vendor` */
  readonly vendorDir: string;
  /** `minimum-stability`, default `stable`; an unrecognized value falls back to `stable` */
  readonly minimumStability: Stability;
  /** `prefer-stable`, default false */
  readonly preferStable: boolean;
  /** false when `repositories` disables Packagist with `{"packagist.org": false}` (or the legacy `{"packagist": false}`) */
  readonly packagistEnabled: boolean;
}

const SECTIONS = ["require", "require-dev"];

/** A project manifest: `composer.json` anywhere except inside a `vendor/` directory */
export function isComposerJsonPath(path: string): boolean {
  return (
    (path === "composer.json" || path.endsWith("/composer.json")) && !path.includes("/vendor/")
  );
}

/** `Composer\Repository\PlatformRepository::PLATFORM_PACKAGE_REGEX` */
const PLATFORM =
  /^(?:php(?:-64bit|-ipv6|-zts|-debug)?|hhvm|(?:ext|lib)-[a-z0-9](?:[_.-]?[a-z0-9]+)*|composer(?:-(?:plugin|runtime)-api)?)$/i;

/** `php`, `ext-*`, `lib-*` and Composer's own APIs: constraints on the platform, not packages with a license */
export function isPlatformPackage(name: string): boolean {
  return PLATFORM.test(name);
}

/** Composer's package-name rule (`vendor/name`, lowercase), applied to the lowercased name */
export function isPackageName(name: string): boolean {
  return /^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$/.test(
    name.toLowerCase()
  );
}

const STABILITIES: readonly Stability[] = ["dev", "alpha", "beta", "RC", "stable"];

function readStability(value: unknown): Stability {
  if (typeof value !== "string") return "stable";
  const lower = value.toLowerCase();
  return STABILITIES.find((s) => s.toLowerCase() === lower) ?? "stable";
}

/** A repositories entry of the form `{"packagist.org": false}` / `{"packagist": false}` */
function disablesPackagist(repository: unknown): boolean {
  return (
    typeof repository === "object" &&
    repository !== null &&
    (("packagist.org" in repository &&
      (repository as Record<string, unknown>)["packagist.org"] === false) ||
      ("packagist" in repository && (repository as Record<string, unknown>).packagist === false))
  );
}

function propertyValue(root: Node, key: string): unknown {
  const property = root.children?.find(
    (p) => p.type === "property" && p.children?.[0]?.value === key
  );
  const valueNode = property?.children?.[1];
  return valueNode ? nodeToValue(valueNode) : undefined;
}

/** `getNodeValue` without the dependency on a fully valid tree — a half-typed value becomes undefined */
function nodeToValue(node: Node): unknown {
  switch (node.type) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const property of node.children ?? []) {
        const [keyNode, valueNode] = property.children ?? [];
        if (
          property.type === "property" &&
          keyNode &&
          typeof keyNode.value === "string" &&
          valueNode
        ) {
          out[keyNode.value] = nodeToValue(valueNode);
        }
      }
      return out;
    }
    case "array":
      return (node.children ?? []).map(nodeToValue);
    case "property":
      return undefined;
    default:
      return node.value;
  }
}

/**
 * Read the `require` and `require-dev` sections of a composer.json.

 * Uses the jsonc-parser AST so half-typed, temporarily invalid JSON still yields whatever can be read. Names are lowercased, since `composer.lock`, `installed.json` and Packagist all key packages that way. Platform packages produce no entry: they constrain PHP itself, not a package with a license.
 */
export function parseComposerJson(
  document: TextDocumentLike,
  manifestDir: string
): ComposerManifest {
  const root = parseTree(document.getText());
  const entries: ComposerEntry[] = [];
  let vendorDir = "vendor";
  let minimumStability: Stability = "stable";
  let preferStable = false;
  let packagistEnabled = true;

  if (root && root.type === "object" && root.children) {
    for (const property of root.children) {
      if (property.type !== "property" || !property.children || property.children.length < 2) {
        continue;
      }
      const [keyNode, valueNode] = property.children;
      const section = keyNode.value;
      if (
        typeof section !== "string" ||
        !SECTIONS.includes(section) ||
        valueNode.type !== "object"
      ) {
        continue;
      }
      for (const dependency of valueNode.children ?? []) {
        if (
          dependency.type !== "property" ||
          !dependency.children ||
          dependency.children.length < 2
        ) {
          continue;
        }
        const [nameNode, specNode] = dependency.children;
        if (typeof nameNode.value !== "string" || typeof specNode.value !== "string") continue;
        const name = nameNode.value.toLowerCase();
        if (isPlatformPackage(name)) continue;
        const spec = specNode.value;
        entries.push(
          new ComposerEntry(
            name,
            spec,
            section,
            document.positionAt(nameNode.offset).line,
            manifestDir,
            parseConstraint(spec)
          )
        );
      }
    }

    const config = propertyValue(root, "config");
    if (typeof config === "object" && config !== null) {
      const dir = (config as Record<string, unknown>)["vendor-dir"];
      if (typeof dir === "string" && dir.trim() !== "") vendorDir = dir.trim().replace(/\/+$/, "");
    }
    minimumStability = readStability(propertyValue(root, "minimum-stability"));
    preferStable = propertyValue(root, "prefer-stable") === true;
    const repositories = propertyValue(root, "repositories");
    const list = Array.isArray(repositories)
      ? repositories
      : typeof repositories === "object" && repositories !== null
        ? Object.values(repositories)
        : [];
    if (list.some(disablesPackagist) || disablesPackagist(repositories)) packagistEnabled = false;
  }

  return { entries, vendorDir, minimumStability, preferStable, packagistEnabled };
}
