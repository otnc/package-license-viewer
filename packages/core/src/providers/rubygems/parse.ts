import type { DependencyEntry } from "../types";

/** What one dependency declaration amounts to */
export type RubyDeclaration =
  /** A gem to look up on RubyGems, under its real (literal) name */
  | { kind: "rubygems"; name: string; requirements: string[] }
  /** Deliberately not resolved (git/path gem, non-default source, …) */
  | { kind: "skipped"; reason: string }
  /** Resolution was attempted but the declaration could not be read */
  | { kind: "unknown"; reason: string };

export class RubyEntry implements DependencyEntry {
  constructor(
    readonly name: string,
    readonly spec: string,
    readonly section: string,
    readonly line: number,
    readonly declaration: RubyDeclaration,
    readonly manifestUri: string
  ) {}
}

/** Whether this path is a Bundler manifest */
export function isGemfilePath(path: string): boolean {
  return path === "Gemfile" || path.endsWith("/Gemfile");
}

/** Whether this path is a RubyGems specification */
export function isGemspecPath(path: string): boolean {
  return path.endsWith(".gemspec");
}

type Token =
  | { kind: "string"; value: string; interpolated: boolean; line: number }
  | { kind: "symbol"; value: string; line: number }
  | { kind: "label"; value: string; line: number }
  | { kind: "ident"; value: string; line: number }
  | { kind: "other"; value: string; line: number }
  | { kind: "newline"; line: number };

const OPENERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSERS = new Set([")", "]", "}"]);

/**
 * Blank out heredoc bodies, keeping line numbers. Gemspecs describe themselves
 * with heredocs (`spec.description = <<~DESC … DESC`), and prose in there that
 * happens to start with `gem` is not a dependency declaration. The line that
 * opens the heredoc stays: a declaration can share it.
 */
function stripHeredocs(text: string): string {
  const lines = text.split("\n");
  const pending: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (pending.length > 0) {
      if (lines[index].trim() === pending[0]) pending.shift();
      else lines[index] = "";
      continue;
    }
    for (const match of lines[index].matchAll(/<<[-~]?["']?([A-Za-z_][A-Za-z0-9_]*)["']?/g)) {
      pending.push(match[1]);
    }
  }
  return lines.join("\n");
}

/**
 * Tokenize just enough Ruby for manifest files: strings (with interpolation
 * flagged, since a computed name or requirement cannot be looked up), symbols,
 * `key:` labels, identifiers, and the punctuation that structures a call.
 * Comments are dropped. Anything not recognized becomes an opaque token, so a
 * construct this does not understand never aborts the parse — following the
 * same rule as the go.mod and moon.mod parsers, one half-typed declaration
 * must not blank out the ones around it.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let line = 0;
  const push = (token: Token) => {
    if (token.kind === "newline" && tokens[tokens.length - 1]?.kind === "newline") return;
    tokens.push(token);
  };
  while (index < text.length) {
    const char = text[index];
    if (char === "\n") {
      push({ kind: "newline", line });
      line++;
      index++;
    } else if (char === " " || char === "\t" || char === "\r") {
      index++;
    } else if (char === "#") {
      while (index < text.length && text[index] !== "\n") index++;
    } else if (char === "'" || char === '"') {
      const scanned = scanString(text, index);
      push({ kind: "string", value: scanned.value, interpolated: scanned.interpolated, line });
      line += scanned.lines;
      index = scanned.end;
    } else if (char === "%" && /^%[wWiIqQ]?[([{<|/'"`]/.test(text.slice(index, index + 3))) {
      // A %-literal (usually %w[…] word lists in a gemspec): one opaque token
      const scanned = scanPercentLiteral(text, index);
      line += scanned.lines;
      index = scanned.end;
      push({ kind: "other", value: "%", line });
    } else if (char === ":" && /[A-Za-z_]/.test(text[index + 1] ?? "")) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*[!?]?/.exec(text.slice(index + 1))!;
      push({ kind: "symbol", value: match[0], line });
      index += 1 + match[0].length;
    } else if (char === ":" && (text[index + 1] === "'" || text[index + 1] === '"')) {
      const scanned = scanString(text, index + 1);
      push({ kind: "symbol", value: scanned.value, line });
      line += scanned.lines;
      index = scanned.end;
    } else if (/[A-Za-z_@$]/.test(char)) {
      const match = /^[@$]*[A-Za-z_][A-Za-z0-9_]*[!?=]?/.exec(text.slice(index))!;
      const value = match[0].replace(/^[@$]+/, "");
      index += match[0].length;
      // `name:` with no space before the colon is a hash label, not an identifier
      if (
        text[index] === ":" &&
        text[index + 1] !== ":" &&
        !value.endsWith("?") &&
        !value.endsWith("!")
      ) {
        push({ kind: "label", value, line });
        index++;
      } else {
        push({ kind: "ident", value, line });
      }
    } else if (/[0-9]/.test(char)) {
      const match = /^[0-9][0-9A-Za-z._]*/.exec(text.slice(index))!;
      push({ kind: "other", value: match[0], line });
      index += match[0].length;
    } else if (text.startsWith("=>", index)) {
      push({ kind: "other", value: "=>", line });
      index += 2;
    } else if (text.startsWith("::", index)) {
      push({ kind: "other", value: "::", line });
      index += 2;
    } else if (char === "\\" && text[index + 1] === "\n") {
      // A line continuation joins the next line into this statement
      line++;
      index += 2;
    } else {
      push({ kind: "other", value: char, line });
      index++;
    }
  }
  return tokens;
}

function scanString(
  text: string,
  start: number
): { value: string; interpolated: boolean; end: number; lines: number } {
  const quote = text[start];
  let index = start + 1;
  let value = "";
  let interpolated = false;
  let lines = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\n") {
      lines++;
      value += char;
      index++;
    } else if (char === "\\" && index + 1 < text.length) {
      const next = text[index + 1];
      if (quote === "'") {
        // In single quotes only \\ and \' are escapes; other backslashes are literal
        value += next === "\\" || next === "'" ? next : "\\" + next;
      } else {
        value += next === "n" ? "\n" : next === "t" ? "\t" : next;
      }
      index += 2;
    } else if (quote === '"' && char === "#" && text[index + 1] === "{") {
      interpolated = true;
      // Skip the interpolated expression, counting braces
      let depth = 0;
      while (index < text.length) {
        if (text[index] === "{") depth++;
        else if (text[index] === "}") {
          depth--;
          if (depth === 0) {
            index++;
            break;
          }
        } else if (text[index] === "\n") lines++;
        index++;
      }
    } else if (
      quote === '"' &&
      char === "#" &&
      (text[index + 1] === "@" || text[index + 1] === "$")
    ) {
      interpolated = true;
      index += 2;
    } else if (char === quote) {
      return { value, interpolated, end: index + 1, lines };
    } else {
      value += char;
      index++;
    }
  }
  // An unterminated string runs to the end of the input rather than throwing
  return { value, interpolated, end: index, lines };
}

function scanPercentLiteral(text: string, start: number): { end: number; lines: number } {
  let index = start + 1;
  if (/[wWiIqQ]/.test(text[index] ?? "")) index++;
  const open = text[index] ?? "";
  const close = OPENERS[open] ?? open;
  let depth = 0;
  let lines = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\n") lines++;
    else if (char === "\\") index++;
    else if (char === open && open !== close) depth++;
    else if (char === close) {
      depth--;
      if (depth <= 0) return { end: index + 1, lines };
    }
    index++;
  }
  return { end: index, lines };
}

/** One call's arguments, split into positional strings and `key: value` options */
interface CallArgs {
  /** Positional string literals, in order: name, then requirement strings */
  readonly strings: { value: string; interpolated: boolean }[];
  /** Whether a positional argument was an expression rather than a literal (a variable, `Gem::Requirement.new(…)`, …) */
  readonly nonStringPositional: boolean;
  /** Option keys seen (`git`, `path`, …) with their string/symbol value when literal */
  readonly options: Map<string, string | undefined>;
  /** Index of the token after the call */
  readonly next: number;
}

function valueOf(token: Token | undefined): string | undefined {
  return token && token.kind !== "newline" ? token.value : undefined;
}

function readCallArgs(tokens: readonly Token[], start: number): CallArgs {
  const strings: CallArgs["strings"] = [];
  const options = new Map<string, string | undefined>();
  let nonStringPositional = false;
  let index = start;
  // Bracket stack: a call's own arguments live at the top level, inside its
  // parentheses, or inside one bare `{ … }` options hash — nowhere deeper.
  const stack: string[] = [];
  let parenthesized = false;
  if (valueOf(tokens[index]) === "(") {
    parenthesized = true;
    stack.push("(");
    index++;
  }
  const atContentLevel = () =>
    stack.length === 0 ||
    (stack.length === 1 && (stack[0] === "(" || stack[0] === "{")) ||
    (stack.length === 2 && stack[0] === "(" && stack[1] === "{");
  let previous: Token | undefined;
  let pendingKey: string | undefined;
  let lastWasComma = false;
  for (; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind === "newline") {
      if (
        stack.length === 0 &&
        !lastWasComma &&
        valueOf(previous) !== "=>" &&
        pendingKey === undefined
      ) {
        break;
      }
      continue;
    }
    if (token.kind === "other" && OPENERS[token.value]) {
      stack.push(token.value);
      previous = token;
      continue;
    }
    if (token.kind === "other" && CLOSERS.has(token.value)) {
      if (stack.length === 0) break;
      stack.pop();
      previous = token;
      if (stack.length === 0 && parenthesized) {
        index++;
        break;
      }
      continue;
    }
    if (atContentLevel()) {
      if (token.kind === "label") {
        pendingKey = token.value;
        previous = token;
        continue;
      }
      if (token.kind === "other" && token.value === "=>") {
        if (previous?.kind === "symbol" || previous?.kind === "string") {
          pendingKey = previous.value;
        }
        previous = token;
        continue;
      }
      if (token.kind === "other" && token.value === ",") {
        lastWasComma = true;
        pendingKey = undefined;
        previous = token;
        continue;
      }
      lastWasComma = false;
      if (token.kind === "string") {
        if (pendingKey !== undefined) {
          options.set(pendingKey, token.value);
        } else {
          strings.push({ value: token.value, interpolated: token.interpolated });
        }
        pendingKey = undefined;
      } else if (token.kind === "symbol") {
        if (pendingKey !== undefined) {
          options.set(pendingKey, token.value);
          pendingKey = undefined;
        }
        // A bare positional symbol is not a name or requirement; ignore it
      } else if (pendingKey !== undefined) {
        // An option whose value is computed (`git: url_for(…)`, `require: false`, …)
        if (!options.has(pendingKey)) options.set(pendingKey, undefined);
        pendingKey = undefined;
      } else if (token.kind === "ident") {
        nonStringPositional = true;
      }
      // Any other positional token is not a name or a requirement by itself
    }
    previous = token;
  }
  return { strings, nonStringPositional, options, next: index };
}

const SOURCE_KEYS = ["git", "github", "path"] as const;

/** Turn one `gem`-style call into a declaration */
function declarationOf(args: CallArgs): RubyDeclaration {
  const [name, ...requirements] = args.strings;
  if (!name) {
    return { kind: "unknown", reason: "dependency name is not a string literal" };
  }
  if (name.interpolated) {
    return { kind: "unknown", reason: "dependency name is computed, not a literal" };
  }
  if (requirements.some((requirement) => requirement.interpolated)) {
    return { kind: "unknown", reason: "version requirement is computed, not a literal" };
  }
  for (const key of SOURCE_KEYS) {
    if (args.options.has(key)) {
      return { kind: "skipped", reason: "git and path gems are not published to RubyGems" };
    }
  }
  if (args.options.has("source")) {
    const source = args.options.get("source");
    if (source === undefined) {
      return { kind: "unknown", reason: "declared with a computed source" };
    }
    if (!/^https?:\/\/rubygems\.org\/?$/.test(source)) {
      return { kind: "skipped", reason: "declared with a non-default source" };
    }
  }
  return { kind: "rubygems", name: name.value, requirements: requirements.map((r) => r.value) };
}

function specOf(declaration: RubyDeclaration): string {
  return declaration.kind === "rubygems" ? declaration.requirements.join(", ") : "";
}

function displayName(declaration: RubyDeclaration, args: CallArgs): string {
  if (declaration.kind === "rubygems") return declaration.name;
  return args.strings[0]?.value ?? "";
}

/**
 * Read the `gem` calls of a Gemfile.
 *
 * Bundler's Gemfile is executable Ruby, but a dependency declaration is a
 * single call — `gem "rails", "~> 8.0"`, optionally with an options hash —
 * and only those calls are read. Gems inside a `source "…" do … end` block
 * whose source is not rubygems.org are skipped, as are `git:`/`github:`/
 * `path:` gems wherever they appear: neither is published to RubyGems under
 * that name in a form this can verify. `gemspec`, `source`, `ruby` and every
 * other directive say nothing about a dependency's license and are skipped,
 * as is any call that does not parse, so a half-typed line never blanks out
 * the declarations around it. Nothing is executed.
 */
export function parseGemfile(text: string, manifestUri: string): RubyEntry[] {
  const tokens = tokenize(stripHeredocs(text));
  const entries: RubyEntry[] = [];
  // `do … end` frames, the innermost last; a frame opened by `source` carries its URL
  const frames: { source?: string }[] = [];
  let statementStart = true;
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.kind === "newline" || (token.kind === "other" && token.value === ";")) {
      statementStart = true;
      index++;
      continue;
    }
    if (token.kind === "ident" && token.value === "end") {
      frames.pop();
      statementStart = false;
      index++;
      continue;
    }
    if (token.kind === "ident" && token.value === "do") {
      frames.push({});
      statementStart = false;
      index++;
      continue;
    }
    if (token.kind === "ident" && token.value === "source" && statementStart) {
      // `source "url" do … end`: remember the URL for the frame its `do` opens
      const next = tokens[index + 1];
      const after = tokens[index + 2];
      if (next?.kind === "string" && after?.kind === "ident" && after.value === "do") {
        frames.push({ source: next.value });
        index += 3;
        statementStart = false;
        continue;
      }
    }
    if (token.kind === "ident" && token.value === "gem" && valueOf(tokens[index - 1]) !== ".") {
      const args = readCallArgs(tokens, index + 1);
      let declaration = declarationOf(args);
      if (declaration.kind === "rubygems") {
        const enclosing = [...frames].reverse().find((frame) => frame.source !== undefined);
        if (
          enclosing?.source !== undefined &&
          !/^https?:\/\/rubygems\.org\/?$/.test(enclosing.source)
        ) {
          declaration = { kind: "skipped", reason: "declared with a non-default source" };
        }
      }
      if (args.strings.length > 0) {
        entries.push(
          new RubyEntry(
            displayName(declaration, args),
            specOf(declaration),
            "Gemfile",
            token.line,
            declaration,
            manifestUri
          )
        );
      }
      index = Math.max(args.next, index + 1);
      statementStart = false;
      continue;
    }
    statementStart = false;
    index++;
  }
  return entries;
}

const GEMSPEC_METHODS = new Map([
  ["add_dependency", "dependencies"],
  ["add_runtime_dependency", "dependencies"],
  ["add_development_dependency", "development dependencies"],
]);

/**
 * Read the dependency calls of a `.gemspec`: `spec.add_dependency "rake",
 * "~> 13.0"` and its runtime/development variants, on any receiver. These
 * calls take no source options — a gemspec dependency is always a RubyGems
 * name — so only a non-literal name or requirement is unreadable.
 */
export function parseGemspec(text: string, manifestUri: string): RubyEntry[] {
  const tokens = tokenize(stripHeredocs(text));
  const entries: RubyEntry[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (
      token.kind === "other" &&
      token.value === "." &&
      tokens[index + 1]?.kind === "ident" &&
      GEMSPEC_METHODS.has((tokens[index + 1] as { value: string }).value)
    ) {
      const method = tokens[index + 1] as { value: string; line: number };
      const args = readCallArgs(tokens, index + 2);
      let declaration = declarationOf(args);
      if (declaration.kind === "rubygems" && args.nonStringPositional) {
        // A requirement written as an expression (`Gem::Requirement.new(…)`,
        // a constant, …) cannot be read as a literal — unlike a Gemfile, a
        // gemspec dependency call has no modifier-`if` idiom to confuse it with
        declaration = { kind: "unknown", reason: "version requirement is not a literal" };
      }
      if (args.strings.length > 0) {
        entries.push(
          new RubyEntry(
            displayName(declaration, args),
            specOf(declaration),
            GEMSPEC_METHODS.get(method.value)!,
            method.line,
            declaration,
            manifestUri
          )
        );
      }
      index = Math.max(args.next, index + 1);
      continue;
    }
    index++;
  }
  return entries;
}
