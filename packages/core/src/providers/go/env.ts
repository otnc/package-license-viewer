import * as os from "node:os";
import * as path from "node:path";
import { TtlCache } from "../../ttlCache";
import type { ProviderHost } from "../types";
import { fileUriFromPath } from "../uri";

/** Re-read the go env file at most this often, so typing does not hit the disk on every keystroke */
const CACHE_TTL_MS = 30_000;

/**
 * The variables that mark a module as one the public infrastructure must not be asked about. `GOPRIVATE` is the usual one; `GONOPROXY` and `GONOSUMDB` default to it and are honored on their own too, since setting either one says the same thing about a module.
 */
const PRIVATE_VARIABLES = ["GOPRIVATE", "GONOPROXY", "GONOSUMDB"] as const;

/**
 * Which modules are private, as far as the go command is configured to know.

 * The go command reads a variable from the process environment first and from its env file (what `go env -w` writes) second, so both are consulted in that order. A module whose path matches any of the patterns is never sent to deps.dev: its name alone may be something its owner does not want leaving the machine.
 */
export class GoEnvironment {
  private envFile = new TtlCache<Promise<ReadonlyMap<string, string>>>(CACHE_TTL_MS, 1);

  constructor(private readonly host: ProviderHost) {}

  async isPrivate(modulePath: string): Promise<boolean> {
    const file = await this.readEnvFile();
    return PRIVATE_VARIABLES.some((name) => {
      const patterns = process.env[name] ?? file.get(name);
      return patterns !== undefined && matchPrefixPatterns(patterns, modulePath);
    });
  }

  invalidate(): void {
    this.envFile.clear();
  }

  private readEnvFile(): Promise<ReadonlyMap<string, string>> {
    const cached = this.envFile.get("");
    if (cached) return cached.value;
    const read = this.read();
    this.envFile.set("", read);
    return read;
  }

  private async read(): Promise<ReadonlyMap<string, string>> {
    const file = envFilePath();
    if (!file) return new Map();
    try {
      const bytes = await this.host.fs.readFile(this.host.parseUri(fileUriFromPath(file)));
      return parseEnvFile(new TextDecoder("utf-8").decode(bytes));
    } catch {
      return new Map();
    }
  }
}

/**
 * Where `go env -w` keeps its settings: `$GOENV`, or `go/env` under `os.UserConfigDir()`. `GOENV=off` turns the file off.
 */
function envFilePath(): string | undefined {
  const configured = process.env.GOENV;
  if (configured === "off") return undefined;
  if (configured) return configured;
  const configDir = userConfigDir();
  return configDir ? path.join(configDir, "go", "env") : undefined;
}

/** Go's `os.UserConfigDir()` */
function userConfigDir(): string | undefined {
  if (process.platform === "win32") return process.env.AppData || undefined;
  const home = os.homedir();
  if (process.platform === "darwin") {
    return home ? path.join(home, "Library", "Application Support") : undefined;
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && path.isAbsolute(xdg)) return xdg;
  return home ? path.join(home, ".config") : undefined;
}

/** `KEY=VALUE` lines; the go command writes nothing else there */
export function parseEnvFile(text: string): Map<string, string> {
  const variables = new Map<string, string>();
  for (const line of text.split("\n")) {
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    variables.set(line.slice(0, equals).trim(), line.slice(equals + 1).trim());
  }
  return variables;
}

/**
 * `module.MatchPrefixPatterns`: whether any comma-separated glob matches a leading run of `target`'s path elements.

 * A glob of N elements is compared with the first N elements of the path, so `corp.example.com` also covers `corp.example.com/team/repo`, and `*.corp.example.com` every module under any of its subdomains.
 */
export function matchPrefixPatterns(globs: string, target: string): boolean {
  for (const rawGlob of globs.split(",")) {
    const glob = rawGlob.trim();
    if (glob.length === 0) continue;
    const elements = glob.split("/").length;
    const targetElements = target.split("/");
    if (targetElements.length < elements) continue;
    const pattern = globToRegExp(glob);
    if (pattern?.test(targetElements.slice(0, elements).join("/"))) return true;
  }
  return false;
}

/**
 * `path.Match` syntax as a regular expression: `*` and `?` never cross a `/`, `[…]` is a character class (`^` negates it), and `\` escapes the next character. A malformed pattern matches nothing, as it does in Go.
 */
function globToRegExp(glob: string): RegExp | undefined {
  let source = "";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "\\") {
      index++;
      if (index >= glob.length) return undefined;
      source += escapeRegExp(glob[index]);
    } else if (char === "[") {
      const end = glob.indexOf("]", index + 1);
      if (end === -1) return undefined;
      let body = glob.slice(index + 1, end);
      const negated = body.startsWith("^");
      if (negated) body = body.slice(1);
      if (body.length === 0) return undefined;
      // Negated, the class must still not match a `/`, just like `*`
      source += `[${negated ? "^/" : ""}${body}]`;
      index = end;
    } else {
      source += escapeRegExp(char);
    }
  }
  try {
    return new RegExp(`^${source}$`);
  } catch {
    return undefined;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
