import { parseTree, type Node } from "jsonc-parser";
import type { DependencyEntry } from "../types";
import { readImportItems, readStringAssignment, tokenize } from "./dsl";

/** Which of the two module manifest formats a file is written in */
export type MoonbitFormat = "dsl" | "json";

/** What a dependency declaration in a module manifest amounts to */
export type MoonbitDeclaration =
  /** A mooncakes.io module. `version` is absent only for the object form that omits it. */
  | { kind: "registry"; version?: string }
  | { kind: "skipped"; reason: string }
  | { kind: "unknown"; reason: string };

export class MoonbitEntry implements DependencyEntry {
  constructor(
    readonly name: string,
    readonly spec: string,
    readonly section: string,
    readonly line: number,
    readonly declaration: MoonbitDeclaration,
    readonly manifestUri: string
  ) {}
}

export interface MoonbitManifest {
  /** The module's own `name`, when it declares a readable one */
  readonly moduleName?: string;
  readonly entries: MoonbitEntry[];
}

/** The two names moon gives a module manifest, newest first */
const MODULE_MANIFESTS = ["moon.mod", "moon.mod.json"] as const;

/** Which format, if any, this path is a module manifest in */
export function manifestFormat(path: string): MoonbitFormat | undefined {
  if (path.endsWith("/moon.mod")) return "dsl";
  if (path.endsWith("/moon.mod.json")) return "json";
  return undefined;
}

export { MODULE_MANIFESTS };

/**
 * Sections of `moon.mod.json` that hold dependencies.

 * `bin-deps` is deprecated in favour of publishing portable Wasm tools, but the modules it names are ordinary mooncakes.io modules with ordinary licenses, so they resolve exactly like `deps`.
 */
const JSON_SECTIONS = ["deps", "bin-deps"] as const;

/**
 * Read a module manifest in either format.

 * `moon.mod` states its dependencies as `import { "user/module@version" }`; `moon.mod.json` as a `deps` object. moon itself lowers the former into the latter by splitting each item on its last `@` and rejecting anything without both halves, so that is exactly what happens here.
 */
export function parseManifest(text: string, uri: string, format: MoonbitFormat): MoonbitManifest {
  const lines = new LineIndex(text);
  return format === "dsl" ? parseDsl(text, uri, lines) : parseJson(text, uri, lines);
}

function parseDsl(text: string, uri: string, lines: LineIndex): MoonbitManifest {
  const tokens = tokenize(text);
  const entries = readImportItems(tokens).map((item) => {
    const declaration = importItem(item.value);
    return new MoonbitEntry(
      declaration.name,
      item.value,
      "import",
      lines.lineAt(item.end),
      declaration.declaration,
      uri
    );
  });
  return { moduleName: readStringAssignment(tokens, "name"), entries };
}

/** Split `user/module@version` the way moon does — on the *last* `@`, both halves required */
function importItem(spec: string): { name: string; declaration: MoonbitDeclaration } {
  const at = spec.lastIndexOf("@");
  const name = at > 0 ? spec.slice(0, at) : spec;
  const version = at > 0 ? spec.slice(at + 1) : "";
  if (at <= 0 || version.length === 0) {
    return {
      name: spec,
      declaration: {
        kind: "unknown",
        reason: "`import` only accepts `module@version` in moon.mod",
      },
    };
  }
  return { name, declaration: { kind: "registry", version } };
}

function parseJson(text: string, uri: string, lines: LineIndex): MoonbitManifest {
  const root = parseTree(text);
  if (!root || root.type !== "object" || !root.children) {
    return { entries: [] };
  }

  let moduleName: string | undefined;
  const entries: MoonbitEntry[] = [];

  for (const property of root.children) {
    const [keyNode, valueNode] = propertyOf(property) ?? [];
    if (!keyNode || !valueNode || typeof keyNode.value !== "string") {
      continue;
    }
    if (keyNode.value === "name" && typeof valueNode.value === "string") {
      moduleName = valueNode.value;
      continue;
    }
    if (!JSON_SECTIONS.includes(keyNode.value as (typeof JSON_SECTIONS)[number])) {
      continue;
    }
    if (valueNode.type !== "object") {
      continue;
    }
    for (const dependency of valueNode.children ?? []) {
      const [nameNode, declarationNode] = propertyOf(dependency) ?? [];
      if (!nameNode || !declarationNode || typeof nameNode.value !== "string") {
        continue;
      }
      if (nameNode.value.length === 0) {
        continue;
      }
      entries.push(
        new MoonbitEntry(
          nameNode.value,
          text.slice(declarationNode.offset, declarationNode.offset + declarationNode.length),
          keyNode.value,
          lines.lineAt(dependency.offset + dependency.length),
          jsonDeclaration(declarationNode),
          uri
        )
      );
    }
  }

  return { moduleName, entries };
}

function propertyOf(node: Node): [Node, Node] | undefined {
  if (node.type !== "property" || !node.children || node.children.length < 2) {
    return undefined;
  }
  return [node.children[0], node.children[1]];
}

/**
 * Interpret one `deps` value.

 * The [schema](https://github.com/moonbitlang/moon/blob/main/crates/moonbuild/template/mod.schema.json) allows a bare version string or an object; `path` makes it a directory on disk and `git` a checkout, neither of which mooncakes.io knows anything about.
 */
function jsonDeclaration(node: Node): MoonbitDeclaration {
  if (node.type === "string" && typeof node.value === "string") {
    return node.value.length > 0
      ? { kind: "registry", version: node.value }
      : { kind: "unknown", reason: "empty version" };
  }
  if (node.type !== "object") {
    return { kind: "unknown", reason: "invalid dependency declaration" };
  }

  const fields = new Map<string, Node>();
  for (const property of node.children ?? []) {
    const [keyNode, valueNode] = propertyOf(property) ?? [];
    if (keyNode && valueNode && typeof keyNode.value === "string") {
      fields.set(keyNode.value, valueNode);
    }
  }

  if (fields.has("path")) return { kind: "skipped", reason: "local path dependency" };
  if (fields.has("git")) return { kind: "skipped", reason: "git dependency" };

  const version = fields.get("version");
  if (!version) {
    // A registry dependency with no version at all; moon resolves it to the newest release.
    return { kind: "registry" };
  }
  return typeof version.value === "string" && version.value.length > 0
    ? { kind: "registry", version: version.value }
    : { kind: "unknown", reason: "invalid version" };
}

/** Turns an offset into a zero-based line, without needing a TextDocument */
class LineIndex {
  private readonly starts: number[] = [0];

  constructor(text: string) {
    for (let index = 0; index < text.length; index++) {
      if (text[index] === "\n") this.starts.push(index + 1);
    }
  }

  lineAt(offset: number): number {
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.starts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  }
}
