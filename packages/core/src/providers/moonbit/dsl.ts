/**
 * A reader for the small declarative language `moon.mod` and `moon.work` are written in.

 * moon is replacing its JSON manifests with a DSL whose grammar is published with the [module documentation](https://docs.moonbitlang.com/en/latest/toolchain/moon/module.html):

 * ```
 * moon_mod    ::= statement*
 * statement   ::= import | assign | apply
 * import      ::= "import" "{" (import_item ",")* import_item? "}" import_kind?
 * import_item ::= STRING
 * assign      ::= LIDENT "=" expr
 * apply       ::= LIDENT "(" (argument ",")* argument? ")"
 * ```

 * Only three shapes are needed here — the strings inside a top-level `import` block, a top-level `key = "string"`, and a top-level `key = [ … ]` — so this walks the token stream structurally instead of building an AST. Whatever it does not recognize is skipped rather than rejected, for the same reason the npm provider parses with jsonc-parser: a manifest gets annotated while it is still being typed, and a half-written statement further down must not blank out the dependencies above it.
 */

export type DslTokenKind = "string" | "ident" | "punct";

export interface DslToken {
  readonly kind: DslTokenKind;
  /** The decoded text for a string, the identifier or the single character otherwise */
  readonly value: string;
  /** Offset of the first character of the token, the opening quote included for a string */
  readonly start: number;
  /** Offset just past the token, the closing quote included for a string */
  readonly end: number;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const WHITESPACE = /[\s]/;

/**
 * Split the source into strings, identifiers and single characters.

 * moon's own lexer also has tokens for integers, booleans and `@package/names`; those fall through to single-character `punct` tokens here, which is harmless because nothing below ever matches on them. An unterminated string ends the scan — the rest of the file cannot be read reliably past it anyway.
 */
export function tokenize(text: string): DslToken[] {
  const tokens: DslToken[] = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (WHITESPACE.test(char)) {
      index++;
      continue;
    }

    // `//` runs to the end of the line; moon has no block comments
    if (char === "/" && text[index + 1] === "/") {
      const newline = text.indexOf("\n", index);
      index = newline === -1 ? text.length : newline + 1;
      continue;
    }

    if (char === '"') {
      const string = readString(text, index);
      if (!string) {
        break;
      }
      tokens.push(string);
      index = string.end;
      continue;
    }

    if (IDENT_START.test(char)) {
      let end = index + 1;
      while (end < text.length && IDENT_PART.test(text[end])) {
        end++;
      }
      tokens.push({ kind: "ident", value: text.slice(index, end), start: index, end });
      index = end;
      continue;
    }

    tokens.push({ kind: "punct", value: char, start: index, end: index + 1 });
    index++;
  }

  return tokens;
}

function readString(text: string, start: number): DslToken | undefined {
  let value = "";
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      const escaped = text[index + 1];
      if (escaped === undefined) {
        return undefined;
      }
      value += ESCAPES[escaped] ?? escaped;
      index += 2;
      continue;
    }
    if (char === '"') {
      return { kind: "string", value, start, end: index + 1 };
    }
    value += char;
    index++;
  }
  return undefined;
}

const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", "0": "\0" };

/** Does this token open a nesting level? */
function opens(token: DslToken): boolean {
  return (
    token.kind === "punct" && (token.value === "{" || token.value === "[" || token.value === "(")
  );
}

/** Does this token close a nesting level? */
function closes(token: DslToken): boolean {
  return (
    token.kind === "punct" && (token.value === "}" || token.value === "]" || token.value === ")")
  );
}

/**
 * The string items of the top-level `import { … }` block, in source order.

 * Nested braces are counted so that a `rule(…)` or an options object elsewhere in the file can never contribute items, and a trailing `import_kind` after the closing brace is simply not part of what gets collected.
 */
export function readImportItems(tokens: readonly DslToken[]): DslToken[] {
  const items: DslToken[] = [];
  let depth = 0;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (depth === 0 && token.kind === "ident" && token.value === "import") {
      const brace = tokens[index + 1];
      if (brace && brace.kind === "punct" && brace.value === "{") {
        index = collectStrings(tokens, index + 2, "}", items);
        continue;
      }
    }
    if (opens(token)) depth++;
    else if (closes(token)) depth = Math.max(0, depth - 1);
  }

  return items;
}

/** The value of a top-level `key = "…"` assignment, when there is exactly one to read */
export function readStringAssignment(tokens: readonly DslToken[], key: string): string | undefined {
  const value = findAssignment(tokens, key);
  return value && value.kind === "string" ? value.token.value : undefined;
}

/** The strings of a top-level `key = [ … ]` assignment */
export function readStringArrayAssignment(tokens: readonly DslToken[], key: string): string[] {
  const value = findAssignment(tokens, key);
  if (!value || value.kind !== "array") {
    return [];
  }
  const items: DslToken[] = [];
  collectStrings(tokens, value.index, "]", items);
  return items.map((item) => item.value);
}

type AssignmentValue =
  | { kind: "string"; token: DslToken }
  /** Index of the first token inside the brackets */
  | { kind: "array"; index: number }
  | { kind: "other" };

function findAssignment(tokens: readonly DslToken[], key: string): AssignmentValue | undefined {
  let depth = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (
      depth === 0 &&
      token.kind === "ident" &&
      token.value === key &&
      tokens[index + 1]?.kind === "punct" &&
      tokens[index + 1]?.value === "="
    ) {
      const value = tokens[index + 2];
      if (!value) return undefined;
      if (value.kind === "string") return { kind: "string", token: value };
      if (value.kind === "punct" && value.value === "[") return { kind: "array", index: index + 3 };
      return { kind: "other" };
    }
    if (opens(token)) depth++;
    else if (closes(token)) depth = Math.max(0, depth - 1);
  }
  return undefined;
}

/**
 * Collect the strings directly inside one bracket pair, starting just after the opening bracket.
 * Returns the index of the closing bracket, or of the last token when the file ends first.
 */
function collectStrings(
  tokens: readonly DslToken[],
  start: number,
  closing: string,
  out: DslToken[]
): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index++) {
    const token = tokens[index];
    if (depth === 0 && token.kind === "punct" && token.value === closing) {
      return index;
    }
    if (depth === 0 && token.kind === "string") {
      out.push(token);
      continue;
    }
    if (opens(token)) depth++;
    else if (closes(token)) depth = Math.max(0, depth - 1);
  }
  return tokens.length - 1;
}
