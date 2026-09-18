import { Node, parseTree } from "jsonc-parser";
import type { DependencyEntry, TextDocumentLike } from "../types";

export interface NpmParseOptions {
  /** Top-level sections that are always annotated */
  readonly sections: readonly string[];
  /** Also pick up any other section whose name ends with `dependencies` */
  readonly autoDetectSections: boolean;
}

/**
 * Extract dependencies from a package.json.

 * Uses the jsonc-parser AST so half-typed, temporarily invalid JSON still yields whatever can be read.
 */
export function parsePackageJson(
  document: TextDocumentLike,
  options: NpmParseOptions
): DependencyEntry[] {
  const root = parseTree(document.getText());
  if (!root || root.type !== "object" || !root.children) {
    return [];
  }

  const wanted = new Set(options.sections);
  const entries: DependencyEntry[] = [];

  for (const property of root.children) {
    if (property.type !== "property" || !property.children || property.children.length < 2) {
      continue;
    }
    const [keyNode, valueNode] = property.children;
    const section = keyNode.value;
    if (typeof section !== "string" || valueNode.type !== "object") {
      continue;
    }
    if (!wanted.has(section) && !(options.autoDetectSections && isDependencySection(section))) {
      continue;
    }
    collectSection(document, valueNode, section, entries);
  }

  return entries;
}

/** Does this section name end in `dependencies`? (peerDependencies, myCustomDependencies, …) */
function isDependencySection(name: string): boolean {
  return /dependencies$/i.test(name);
}

function collectSection(
  document: TextDocumentLike,
  objectNode: Node,
  section: string,
  out: DependencyEntry[]
): void {
  for (const property of objectNode.children ?? []) {
    if (property.type !== "property" || !property.children || property.children.length < 2) {
      continue;
    }
    const [keyNode, valueNode] = property.children;
    const name = keyNode.value;
    const spec = valueNode.value;
    // Non-string values are configuration, not dependencies — peerDependenciesMeta for instance
    if (typeof name !== "string" || typeof spec !== "string" || name.length === 0) {
      continue;
    }
    const line = document.positionAt(property.offset + property.length).line;
    out.push({ name, spec, section, line });
  }
}
