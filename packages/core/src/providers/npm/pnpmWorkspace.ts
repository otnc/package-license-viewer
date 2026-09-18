import type { DependencyEntry, TextDocumentLike } from "../types";

/**
 * Extract dependencies from a pnpm-workspace.yaml `catalog:` (default) and `catalogs:` (named) sections.

 * Unlike `catalog:` inside a package.json — which only points at this file — the versions written here are the real thing: ordinary semver ranges, dist-tags or protocol specifiers, resolved exactly like a normal dependency. Only the parsing differs, so this feeds the same `resolve()`.

 * Written by hand instead of pulling in a YAML parser, the same way `pnpm-lock.yaml` is read in `../lockfile/parsers.ts`: only a small, predictable subset of YAML needs to be understood — two-space-indented `name: spec` maps, optionally one level deeper under a named catalog.
 */
export function parsePnpmWorkspaceYaml(document: TextDocumentLike): DependencyEntry[] {
  const lines = document.getText().split(/\r?\n/);
  const entries: DependencyEntry[] = [];

  let section: "catalog" | "catalogs" | "other" = "other";
  let catalogName: string | undefined;
  let catalogsIndent: number | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0 || /^\s*#/.test(line)) {
      continue;
    }

    const parsed = parseLine(line);
    if (!parsed) {
      continue;
    }

    // A column-0 key switches which top-level section is being read
    if (parsed.indent === 0) {
      section =
        parsed.key === "catalog" ? "catalog" : parsed.key === "catalogs" ? "catalogs" : "other";
      catalogName = undefined;
      catalogsIndent = undefined;
      continue;
    }

    if (section === "catalog") {
      if (parsed.value) {
        entries.push({ name: parsed.key, spec: parsed.value, section: "catalog", line: i });
      }
      continue;
    }

    if (section === "catalogs") {
      // A bare `name:` (no value) at the shallowest indent seen so far opens a named catalog
      if (!parsed.value) {
        catalogsIndent ??= parsed.indent;
        if (parsed.indent === catalogsIndent) {
          catalogName = parsed.key;
        }
        continue;
      }
      if (catalogName && catalogsIndent !== undefined && parsed.indent > catalogsIndent) {
        entries.push({
          name: parsed.key,
          spec: parsed.value,
          section: `catalogs.${catalogName}`,
          line: i,
        });
      }
    }
  }

  return entries;
}

/** Read one `key: value` (or bare `key:`) mapping line, quoted or not, comments stripped */
function parseLine(line: string): { indent: number; key: string; value: string } | undefined {
  const indent = line.length - line.trimStart().length;
  const match = /^\s*(?:'([^']*)'|"([^"]*)"|([^:#\s][^:]*?))\s*:\s*(.*)$/.exec(line);
  if (!match) {
    return undefined;
  }
  const key = match[1] ?? match[2] ?? match[3];
  const rawValue = (match[4] ?? "").replace(/\s+#.*$/, "").trim();
  return { indent, key, value: stripQuotes(rawValue) };
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return value.slice(1, -1);
    }
  }
  return value;
}
