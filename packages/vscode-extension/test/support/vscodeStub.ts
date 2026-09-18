/**
 * A minimal fake `vscode` module — only the APIs `annotator.ts` and `extension.ts` actually call
 * at runtime. Aliased in as the "vscode" import via vitest.config.ts, replacing the old
 * `Module._load` monkey-patch this repo used before switching to Vitest.
 */
import { posix } from "node:path";

export function noopDisposable() {
  return { dispose() {} };
}

export class CancellationTokenSource {
  private cancelled = false;
  private readonly listeners: (() => void)[] = [];
  readonly token = {
    isCancellationRequested: false,
    onCancellationRequested: (listener: (e: unknown) => unknown) => {
      this.listeners.push(() => listener(undefined));
      return noopDisposable();
    },
  };

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.token.isCancellationRequested = true;
    for (const listener of this.listeners) listener();
  }

  dispose(): void {
    this.listeners.length = 0;
  }
}

function fakeUri(uriPath: string, scheme = "", authority = ""): FakeUri {
  return {
    path: uriPath,
    scheme,
    authority,
    toString: () => (scheme ? `${scheme}://${authority}${uriPath}` : uriPath),
    with: (changes: { path?: string; scheme?: string; authority?: string }) =>
      fakeUri(changes.path ?? uriPath, changes.scheme ?? scheme, changes.authority ?? authority),
  };
}

interface FakeUri {
  path: string;
  scheme: string;
  authority: string;
  toString(): string;
  with(changes: { path?: string; scheme?: string; authority?: string }): FakeUri;
}

export const Uri = {
  joinPath(base: FakeUri, ...parts: string[]): FakeUri {
    const joined = posix.normalize([base.path, ...parts].join("/"));
    return fakeUri(joined, base.scheme, base.authority);
  },
  file(fsPath: string): FakeUri {
    const normalized = "/" + fsPath.replace(/\\/g, "/").replace(/^\//, "");
    return fakeUri(normalized);
  },
  parse(value: string): FakeUri {
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/]*)(\/.*)?$/.exec(value);
    if (match) {
      return fakeUri(match[3] ?? "", match[1], match[2]);
    }
    return fakeUri(value);
  },
};

export class Position {
  constructor(
    public line: number,
    public character: number
  ) {}
}

export class Range {
  constructor(
    public startLine: number,
    public startCharacter: number,
    public endLine: number,
    public endCharacter: number
  ) {}
}

export class MarkdownString {
  value: string;
  isTrusted = false;
  constructor(value = "") {
    this.value = value;
  }
}

export class ThemeColor {
  constructor(public id: string) {}
}

export const DecorationRangeBehavior = {
  OpenOpen: 0,
  ClosedClosed: 1,
  OpenClosed: 2,
  ClosedOpen: 3,
};
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };

let visibleTextEditors: unknown[] = [];
/** Tests replace what `window.visibleTextEditors` reports through this. */
export function setVisibleEditors(editors: unknown[]): void {
  visibleTextEditors = editors;
}

let settings: Record<string, unknown> = {};
/** Replace the settings every `getConfiguration().get()` call answers from, for the current test. */
export function setSettings(next: Record<string, unknown>): void {
  settings = next;
}

export const workspace = {
  getConfiguration: (section?: string) => ({
    get: <T>(key: string, fallback?: T): T => {
      const full = section ? `${section}.${key}` : key;
      return full in settings ? (settings[full] as T) : (fallback as T);
    },
  }),
  onDidChangeTextDocument: noopDisposable,
  onDidSaveTextDocument: noopDisposable,
  onDidCloseTextDocument: noopDisposable,
  onDidChangeConfiguration: (
    _listener: (event: { affectsConfiguration(section: string): boolean }) => unknown
  ) => noopDisposable(),
  fs: {
    async readFile(): Promise<Uint8Array> {
      throw new Error("not stubbed");
    },
    async stat(): Promise<{ size: number }> {
      throw new Error("not stubbed");
    },
  },
};

export const window = {
  get visibleTextEditors() {
    return visibleTextEditors;
  },
  createOutputChannel: () => ({ debug() {}, info() {}, warn() {}, error() {}, dispose() {} }),
  createTextEditorDecorationType: (options: unknown) => ({ options, dispose() {} }),
  onDidChangeActiveTextEditor: noopDisposable,
  onDidChangeVisibleTextEditors: noopDisposable,
  showInformationMessage: async () => undefined,
};

export let commands = {
  registerCommand(_name: string, _callback: (...args: unknown[]) => unknown) {
    return noopDisposable();
  },
};
/** Tests replace `commands.registerCommand` through this, to capture what `extension.ts` registers. */
export function setCommands(next: typeof commands): void {
  commands = next;
}
