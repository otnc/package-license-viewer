import { getStaticTOMLValue, parseTOML, type AST } from "toml-eslint-parser";
import type { DependencyEntry } from "../types";
import { matchesRequirement, parseRequirement } from "./spec";

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type CargoSpec =
  | { kind: "registry"; name: string; requirement: string }
  | { kind: "workspace" }
  | { kind: "skipped"; reason: string }
  | { kind: "unknown"; reason: string };

export interface CargoManifest {
  entries: CargoEntry[];
  workspace: boolean;
  workspacePath?: string;
  invalidWorkspace: boolean;
  overrides: string[];
}

export class CargoEntry implements DependencyEntry {
  constructor(
    readonly name: string,
    readonly spec: string,
    readonly section: string,
    readonly line: number,
    readonly declaration: CargoSpec,
    readonly manifestUri: string,
    readonly context: string
  ) {}
}

export function dependencySpec(name: string, value: unknown): CargoSpec {
  if (typeof value === "string") {
    return { kind: "registry", name, requirement: value };
  }
  if (!record(value)) return { kind: "unknown", reason: "invalid dependency declaration" };
  if (["path", "git", "registry", "registry-index"].some((key) => key in value)) {
    return { kind: "skipped", reason: "path, git and explicit registries are not supported" };
  }
  if ("workspace" in value) {
    return value.workspace === true && !("version" in value) && !("package" in value)
      ? { kind: "workspace" }
      : { kind: "unknown", reason: "conflicting workspace dependency declaration" };
  }
  if (
    typeof value.version !== "string" ||
    ("package" in value && typeof value.package !== "string")
  ) {
    return { kind: "unknown", reason: "missing or invalid version/package" };
  }
  return {
    kind: "registry",
    name: typeof value.package === "string" ? value.package : name,
    requirement: value.version,
  };
}

function sectionLength(path: readonly (string | number)[]): number {
  const sections = ["dependencies", "dev-dependencies", "build-dependencies"];
  if (typeof path[0] === "string" && sections.includes(path[0])) return 1;
  if (path[0] === "workspace" && path[1] === "dependencies") return 2;
  if (path[0] === "target" && typeof path[1] === "string" && sections.includes(String(path[2])))
    return 3;
  return 0;
}

/** Recognize crates.io replace IDs without interpreting other sources as public crates. */
function replacedCrate(id: string): string | undefined {
  let packageId = id;
  if (id.includes("://")) {
    const source =
      /^(?:registry\+)?https:\/\/github\.com\/rust-lang\/crates\.io-index\/?#(.+)$/.exec(id);
    if (!source) return undefined;
    packageId = source[1];
  }
  const match = /^([A-Za-z0-9][A-Za-z0-9_-]*)[@:](.+)$/.exec(packageId);
  // Cargo requires a full version in replace keys, unlike general package ID specs.
  if (!match || !matchesRequirement(parseRequirement(`=${match[2]}`), match[2])) return undefined;
  return match[1];
}

/** Whole-document parsing is intentional: malformed TOML never produces partial annotations. */
export function parseManifest(text: string, manifestUri: string): CargoManifest | undefined {
  try {
    const ast = parseTOML(text, { tomlVersion: "1.0" });
    const data: unknown = getStaticTOMLValue(ast);
    if (!record(data)) return undefined;
    const workspace = record(data.workspace);
    const pkg = record(data.package) ? data.package : {};
    const workspacePath = typeof pkg.workspace === "string" ? pkg.workspace : undefined;
    const overrides: string[] = [];
    if (record(data.patch)) {
      for (const [source, patches] of Object.entries(data.patch)) {
        // Cargo treats trailing slashes on the registry index URL as equivalent.
        if (
          source !== "crates-io" &&
          source.replace(/\/+$/, "") !== "https://github.com/rust-lang/crates.io-index"
        )
          continue;
        if (record(patches)) {
          for (const [alias, patch] of Object.entries(patches)) {
            overrides.push(
              record(patch) && typeof patch.package === "string" ? patch.package : alias
            );
          }
        }
      }
    }
    if (record(data.replace)) {
      for (const id of Object.keys(data.replace)) {
        const name = replacedCrate(id);
        if (name) overrides.push(name);
      }
    }
    const context = JSON.stringify([workspace, pkg.workspace, overrides.sort(), data.workspace]);
    const entries = new Map<string, CargoEntry>();
    const collect = (path: (string | number)[], line: number) => {
      const length = sectionLength(path);
      const name = path[length];
      if (!length || typeof name !== "string") return;
      const depPath = path.slice(0, length + 1);
      const key = JSON.stringify(depPath);
      if (entries.has(key)) return;
      let value: unknown = data;
      for (const part of depPath) value = record(value) ? value[part] : undefined;
      const declaration = dependencySpec(name, value);
      entries.set(
        key,
        new CargoEntry(
          name,
          declaration.kind === "registry" ? declaration.requirement : "",
          path.slice(0, length).join("."),
          line,
          declaration,
          manifestUri,
          context
        )
      );
    };
    const visit = (node: AST.TOMLKeyValue, base: (string | number)[]) => {
      const path = [...base, ...getStaticTOMLValue(node.key)];
      collect(path, node.loc.start.line - 1);
      if (node.value.type === "TOMLInlineTable") {
        for (const child of node.value.body) visit(child, path);
      }
    };
    for (const node of ast.body[0].body) {
      if (node.type === "TOMLTable") {
        collect(node.resolvedKey, node.loc.start.line - 1);
        for (const child of node.body) visit(child, node.resolvedKey);
      } else visit(node, []);
    }
    return {
      entries: [...entries.values()],
      workspace,
      workspacePath,
      invalidWorkspace: ("workspace" in pkg && !workspacePath) || (workspace && "workspace" in pkg),
      overrides,
    };
  } catch {
    return undefined;
  }
}
