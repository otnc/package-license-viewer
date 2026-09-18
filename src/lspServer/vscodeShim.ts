/**
 * A minimal fake `vscode` module, just enough of the surface that `config.ts` and `log.ts`
 * actually call at runtime (`workspace.getConfiguration`, `window.createOutputChannel`,
 * `MarkdownString`) for those two files to load and work outside a real VS Code host. It has
 * nothing to do with the `TextDocumentLike`/`FileSystemLike`/`UriLike`/`ProviderHost`
 * abstractions the providers use — those already avoid `vscode` entirely. Modeled on
 * `src/test/unit/vscode-stub.js`, which solves the exact same problem for unit tests.
 */

type SettingsSource = () => Record<string, unknown>;

let settingsSource: SettingsSource = () => ({});

/** Swap in the live settings the LSP client actually sent, once `workspace/configuration` answers. */
export function setSettingsSource(source: SettingsSource): void {
  settingsSource = source;
}

class MarkdownString {
  value: string;
  isTrusted = false;
  constructor(value = "") {
    this.value = value;
  }
}

function logToStderr(level: string) {
  return (message: unknown, ...args: unknown[]) => {
    // stdout carries the LSP JSON-RPC stream; every log line must go to stderr instead.
    console.error(`[${level}]`, message, ...args);
  };
}

export const vscodeShim = {
  MarkdownString,
  workspace: {
    getConfiguration(section?: string) {
      const prefix = section ? `${section}.` : "";
      const settings = settingsSource();
      return {
        get<T>(key: string, fallback?: T): T {
          const full = prefix + key;
          return full in settings ? (settings[full] as T) : (fallback as T);
        },
      };
    },
  },
  window: {
    createOutputChannel(_name: string, _options?: { log?: boolean }) {
      return {
        debug: logToStderr("debug"),
        info: logToStderr("info"),
        warn: logToStderr("warn"),
        error: logToStderr("error"),
        dispose(): void {},
      };
    },
  },
};
