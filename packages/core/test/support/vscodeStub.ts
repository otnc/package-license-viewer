/**
 * A minimal fake `vscode` module — just enough of the surface `config.ts`, `log.ts` and
 * `format.ts` actually touch as values at runtime (`workspace.getConfiguration`,
 * `window.createOutputChannel`, `MarkdownString`) for this package to load and run outside a real
 * VS Code host. Aliased in as the "vscode" import via vitest.config.ts. Everything the providers
 * themselves need instead goes through `TextDocumentLike`/`FileSystemLike`/`UriLike`/`ProviderHost`,
 * which already avoid `vscode` entirely — this stub exists only for the few pieces of core that
 * predate that abstraction. Modeled on `packages/lsp-server/src/vscodeShim.ts`, which solves the
 * exact same problem for the LSP server.
 */

let settings: Record<string, unknown> = {};

/** Replace the settings every `getConfiguration().get()` call answers from, for the current test. */
export function setSettings(next: Record<string, unknown>): void {
  settings = next;
}

export class MarkdownString {
  value: string;
  isTrusted = false;
  constructor(value = "") {
    this.value = value;
  }
}

export const workspace = {
  getConfiguration(section?: string) {
    const prefix = section ? `${section}.` : "";
    return {
      get<T>(key: string, fallback?: T): T {
        const full = prefix + key;
        return full in settings ? (settings[full] as T) : (fallback as T);
      },
    };
  },
};

export const window = {
  createOutputChannel(_name: string, _options?: { log?: boolean }) {
    return {
      debug() {},
      info() {},
      warn() {},
      error() {},
      dispose() {},
    };
  },
};
