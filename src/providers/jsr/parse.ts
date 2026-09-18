import { type Node, parseTree } from "jsonc-parser";
import type { DependencyEntry, TextDocumentLike, UriLike } from "../types";

/** A specifier a Deno manifest can express that we know how to resolve */
export interface DenoSpecifier {
  readonly kind: "jsr" | "npm";
  /** Package name, e.g. `@std/fs` or `chalk` */
  readonly name: string;
  /** Version range, defaulting to `latest` when absent */
  readonly range: string;
}

/** Is this a Deno or import-map manifest? */
export function isDenoManifest(uri: UriLike): boolean {
  const fileName = uri.path.split("/").pop() ?? "";
  return (
    fileName === "deno.json" ||
    fileName === "deno.jsonc" ||
    fileName === "jsr.json" ||
    fileName === "jsr.jsonc" ||
    fileName === "import_map.json" ||
    fileName === "importMap.json"
  );
}

/**
 * Pull the dependencies out of an import map's `imports`.

 * `spec` keeps the original specifier verbatim and is re-read at resolution time, which is how the `jsr:` or `npm:` distinction survives the trip.
 */
export function parseDenoManifest(document: TextDocumentLike): DependencyEntry[] {
  const root = parseTree(document.getText());
  if (!root || root.type !== "object" || !root.children) {
    return [];
  }

  const entries: DependencyEntry[] = [];
  for (const property of root.children) {
    if (property.type !== "property" || !property.children || property.children.length < 2) {
      continue;
    }
    const [keyNode, valueNode] = property.children;
    // A standalone import map has the mapping at the top level; deno.json nests it
    if (keyNode.value === "imports" && valueNode.type === "object") {
      collectImports(document, valueNode, entries);
    }
  }

  // Handle the case where the top level *is* the mapping, as in import_map.json
  if (entries.length === 0 && looksLikeBareImportMap(root)) {
    collectImports(document, root, entries);
  }

  return entries;
}

function looksLikeBareImportMap(root: Node): boolean {
  return (root.children ?? []).some((property) => {
    const value = property.children?.[1]?.value;
    return typeof value === "string" && /^(jsr|npm):/.test(value);
  });
}

function collectImports(
  document: TextDocumentLike,
  objectNode: Node,
  out: DependencyEntry[]
): void {
  for (const property of objectNode.children ?? []) {
    if (property.type !== "property" || !property.children || property.children.length < 2) {
      continue;
    }
    const [keyNode, valueNode] = property.children;
    const alias = keyNode.value;
    const specifier = valueNode.value;
    if (typeof alias !== "string" || typeof specifier !== "string") {
      continue;
    }

    const parsed = parseDenoSpecifier(specifier);
    if (!parsed) {
      continue;
    }

    const line = document.positionAt(property.offset + property.length).line;
    out.push({ name: parsed.name, spec: specifier, section: "imports", line });
  }
}

/**
 * Split `jsr:@std/fs@^1.0.0` or `npm:chalk@^5`. Anything else — `https:`, `node:`, a relative path, or a trailing-slash prefix mapping — is out of scope.
 */
export function parseDenoSpecifier(specifier: string): DenoSpecifier | undefined {
  const trimmed = specifier.trim();
  const match = /^(jsr|npm):(.+)$/.exec(trimmed);
  if (!match) {
    return undefined;
  }

  const kind = match[1] as "jsr" | "npm";
  // A prefix mapping such as `jsr:@std/fs/` carries no version
  let rest = match[2].replace(/^\/+/, "");
  if (rest.endsWith("/")) {
    return undefined;
  }
  // A subpath may follow, as in `npm:chalk@^5/some/entry`
  const scoped = rest.startsWith("@");
  const subPathStart = rest.indexOf("/", scoped ? rest.indexOf("/") + 1 : 0);
  if (subPathStart > 0) {
    rest = rest.slice(0, subPathStart);
  }

  const at = rest.lastIndexOf("@");
  const name = at > 0 ? rest.slice(0, at) : rest;
  const range = at > 0 ? rest.slice(at + 1) : "latest";
  if (name.length === 0) {
    return undefined;
  }

  return { kind, name, range: range.length > 0 ? range : "latest" };
}
