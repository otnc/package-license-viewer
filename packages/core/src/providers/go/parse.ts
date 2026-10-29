import type { DependencyEntry } from "../types";
import { isDirectoryPath } from "./spec";

/** What one `require` line amounts to once `replace` directives are applied */
export type GoDeclaration =
  /** A module to look up. `replaced` says `path`/`version` came from a `replace` target. */
  | { kind: "module"; path: string; version: string; replaced: boolean }
  | { kind: "skipped"; reason: string }
  | { kind: "unknown"; reason: string };

export class GoEntry implements DependencyEntry {
  constructor(
    readonly name: string,
    readonly spec: string,
    readonly section: string,
    readonly line: number,
    readonly declaration: GoDeclaration
  ) {}
}

/** Whether this path is a module's `go.mod` */
export function isGoModPath(path: string): boolean {
  return path === "go.mod" || path.endsWith("/go.mod");
}

interface Require {
  readonly path: string;
  readonly version?: string;
  readonly line: number;
}

interface Replace {
  readonly path: string;
  /** Only this version of `path` is replaced; absent means every version is */
  readonly version?: string;
  readonly target: string;
  readonly targetVersion?: string;
}

/**
 * Read the `require` directives of a `go.mod`, with `replace` directives already applied.

 * The lexical rules are those of `golang.org/x/mod/modfile`: one directive per line, `//` comments, a `verb (` … `)` block standing for the verb repeated on every line inside it, and module paths and versions that may be quoted. Everything other than `require` and `replace` — `module`, `go`, `toolchain`, `exclude`, `retract`, `tool`, `godebug` — says nothing about a dependency's license and is skipped, as is any line that does not parse, so a half-typed directive never blanks out the requirements around it.
 */
export function parseGoMod(text: string): GoEntry[] {
  const requires: Require[] = [];
  const replaces: Replace[] = [];
  let block: string | undefined;

  text.split("\n").forEach((rawLine, line) => {
    const tokens = tokenizeLine(rawLine);
    if (tokens.length === 0) return;

    if (block !== undefined) {
      if (tokens[0] === ")") {
        block = undefined;
        return;
      }
      directive(block, tokens, line);
      return;
    }
    if (tokens.length === 2 && tokens[1] === "(") {
      block = tokens[0];
      return;
    }
    // An empty block written on one line, e.g. `require ()`
    if (tokens[1] === "(") return;
    directive(tokens[0], tokens.slice(1), line);
  });

  function directive(verb: string, args: string[], line: number): void {
    if (verb === "require" && args.length > 0) {
      requires.push({ path: args[0], version: args.length === 2 ? args[1] : undefined, line });
    } else if (verb === "replace") {
      const replace = readReplace(args);
      if (replace) replaces.push(replace);
    }
  }

  return requires.map(
    (require) =>
      new GoEntry(
        require.path,
        require.version ?? "",
        "require",
        require.line,
        declarationOf(require, replaces)
      )
  );
}

/** `old [version] => new [version]`, or undefined when the line is not one */
function readReplace(args: string[]): Replace | undefined {
  const arrow = args.indexOf("=>");
  if (arrow !== 1 && arrow !== 2) return undefined;
  const right = args.slice(arrow + 1);
  if (right.length !== 1 && right.length !== 2) return undefined;
  return {
    path: args[0],
    version: arrow === 2 ? args[1] : undefined,
    target: right[0],
    targetVersion: right[1],
  };
}

function declarationOf(require: Require, replaces: readonly Replace[]): GoDeclaration {
  if (require.version === undefined) {
    return { kind: "unknown", reason: "`require` takes a module path and a version" };
  }

  // A replacement of this exact version takes precedence over one of every version,
  // the same way the go command picks between them.
  let replace: Replace | undefined;
  let exact: Replace | undefined;
  for (const candidate of replaces) {
    if (candidate.path !== require.path) continue;
    if (candidate.version === undefined) replace = candidate;
    else if (candidate.version === require.version) exact = candidate;
  }
  replace = exact ?? replace;

  if (!replace) {
    return { kind: "module", path: require.path, version: require.version, replaced: false };
  }
  if (isDirectoryPath(replace.target)) {
    return replace.targetVersion === undefined
      ? { kind: "skipped", reason: "replaced with a local directory" }
      : { kind: "unknown", reason: "a directory `replace` target cannot have a version" };
  }
  if (replace.targetVersion === undefined) {
    return { kind: "unknown", reason: "a module `replace` target needs a version" };
  }
  return { kind: "module", path: replace.target, version: replace.targetVersion, replaced: true };
}

/**
 * Split one line into tokens, dropping its comment.

 * Parentheses are tokens of their own; a quoted string — interpreted (`"…"`) or raw (`` `…` ``) — is one token holding its unquoted value. An unterminated string ends the line, so it simply yields fewer tokens.
 */
export function tokenizeLine(line: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (char === " " || char === "\t" || char === "\r") {
      index++;
    } else if (line.startsWith("//", index)) {
      break;
    } else if (char === "(" || char === ")") {
      tokens.push(char);
      index++;
    } else if (char === '"' || char === "`") {
      const end = closingQuote(line, index);
      if (end === -1) break;
      tokens.push(unquote(line.slice(index, end + 1)));
      index = end + 1;
    } else {
      const start = index;
      while (index < line.length && !/[\s()]/.test(line[index]) && !line.startsWith("//", index)) {
        index++;
      }
      tokens.push(line.slice(start, index));
    }
  }
  return tokens;
}

function closingQuote(line: string, start: number): number {
  const quote = line[start];
  for (let index = start + 1; index < line.length; index++) {
    if (quote === '"' && line[index] === "\\") index++;
    else if (line[index] === quote) return index;
  }
  return -1;
}

function unquote(quoted: string): string {
  if (quoted.startsWith("`")) return quoted.slice(1, -1);
  try {
    // Go's escapes are a superset of JSON's, and a module path or version never needs the rest
    return JSON.parse(quoted) as string;
  } catch {
    return quoted.slice(1, -1);
  }
}
