const Module = require("node:module");
const path = require("node:path");

/**
 * The `vscode` module only exists inside the extension host, so tests inject a minimal stub to be able to load the source. Only the APIs actually used are implemented.
 */

/** Editors the stub reports as visible. Tests replace this through setVisibleEditors(). */
let visibleTextEditors = [];

function noopDisposable() {
  return { dispose() {} };
}

class CancellationTokenSource {
  constructor() {
    this._cancelled = false;
    this._listeners = [];
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- captured for the getters/methods below
    const self = this;
    this.token = {
      get isCancellationRequested() {
        return self._cancelled;
      },
      onCancellationRequested(listener) {
        self._listeners.push(listener);
        return noopDisposable();
      },
    };
  }
  cancel() {
    if (this._cancelled) {
      return;
    }
    this._cancelled = true;
    for (const listener of this._listeners) {
      listener();
    }
  }
  dispose() {
    this._listeners = [];
  }
}

function fakeUri(uriPath, scheme = "", authority = "") {
  return {
    path: uriPath,
    scheme,
    authority,
    toString: () => (scheme ? `${scheme}://${authority}${uriPath}` : uriPath),
    with: (changes) =>
      fakeUri(changes.path ?? uriPath, changes.scheme ?? scheme, changes.authority ?? authority),
  };
}

const stub = {
  Uri: {
    joinPath(base, ...parts) {
      const joined = path.posix.normalize([base.path, ...parts].join("/"));
      return fakeUri(joined, base.scheme, base.authority);
    },
    file(fsPath) {
      const normalized = "/" + fsPath.replace(/\\/g, "/").replace(/^\//, "");
      return fakeUri(normalized);
    },
    parse(value) {
      const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/]*)(\/.*)?$/.exec(value);
      if (match) {
        return fakeUri(match[3] ?? "", match[1], match[2]);
      }
      return fakeUri(value);
    },
  },
  Position: class {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  },
  Range: class {
    constructor(startLine, startCharacter, endLine, endCharacter) {
      this.startLine = startLine;
      this.startCharacter = startCharacter;
      this.endLine = endLine;
      this.endCharacter = endCharacter;
    }
  },
  MarkdownString: class {
    constructor(value) {
      this.value = value;
    }
  },
  ThemeColor: class {
    constructor(id) {
      this.id = id;
    }
  },
  CancellationTokenSource,
  DecorationRangeBehavior: { OpenOpen: 0, ClosedClosed: 1, OpenClosed: 2, ClosedOpen: 3 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  workspace: {
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    onDidChangeTextDocument: noopDisposable,
    onDidSaveTextDocument: noopDisposable,
    onDidCloseTextDocument: noopDisposable,
    onDidChangeConfiguration: noopDisposable,
    fs: {
      async readFile() {
        throw new Error("not stubbed");
      },
      async stat() {
        throw new Error("not stubbed");
      },
    },
  },
  window: {
    get visibleTextEditors() {
      return visibleTextEditors;
    },
    createOutputChannel: () => ({ debug() {}, info() {}, warn() {}, error() {}, dispose() {} }),
    createTextEditorDecorationType: (options) => ({ options, dispose() {} }),
    onDidChangeActiveTextEditor: noopDisposable,
    onDidChangeVisibleTextEditors: noopDisposable,
  },
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "vscode") {
    return stub;
  }
  return originalLoad.call(this, request, ...rest);
};

/** Build the smallest thing that behaves like a TextDocument */
function fakeDocument(text, fsPath = "d:/project/package.json") {
  const lines = text.split("\n");
  return {
    uri: stub.Uri.file(fsPath).toString(),
    getText: () => text,
    lineCount: lines.length,
    positionAt(offset) {
      let remaining = offset;
      let line = 0;
      while (line < lines.length && remaining > lines[line].length) {
        remaining -= lines[line].length + 1;
        line++;
      }
      return { line, character: remaining };
    },
    lineAt: (index) => ({ text: lines[index] ?? "" }),
  };
}

/**
 * An editor that records every setDecorations call, so tests can assert on what would actually have been drawn.

 * The annotator now spreads one annotation across several decoration types sharing the same range (spacer/before/license/after — see annotator.ts), each contributing its own slice of the `after.contentText`. `lastDecorations` merges the most recent call for every type back into one entry per range, in first-seen type order, so tests can keep asserting on "what the user would actually see" without knowing about the internal split.
 */
function fakeEditor(document) {
  const decorationsByType = new Map();
  const typeOrder = [];
  return {
    document,
    setDecorations(type, options) {
      if (!decorationsByType.has(type)) {
        typeOrder.push(type);
      }
      decorationsByType.set(type, options);
    },
    get lastDecorations() {
      if (typeOrder.length === 0) {
        return undefined;
      }
      const merged = new Map();
      for (const type of typeOrder) {
        for (const option of decorationsByType.get(type) ?? []) {
          const key = `${option.range.startLine}:${option.range.startCharacter}`;
          const text = option.renderOptions?.after?.contentText ?? "";
          const existing = merged.get(key);
          if (existing) {
            existing.renderOptions.after.contentText += text;
            existing.hoverMessage ??= option.hoverMessage;
          } else {
            merged.set(key, {
              range: option.range,
              hoverMessage: option.hoverMessage,
              renderOptions: { after: { contentText: text } },
            });
          }
        }
      }
      return [...merged.values()];
    },
    /** How many of the raw per-type decorations at this position carry a hoverMessage — VS Code shows one hover section per decoration sharing a range, so this must never exceed 1. */
    hoverMessageCountAt(line, character) {
      let count = 0;
      for (const type of typeOrder) {
        for (const option of decorationsByType.get(type) ?? []) {
          if (
            option.range.startLine === line &&
            option.range.startCharacter === character &&
            option.hoverMessage !== undefined
          ) {
            count++;
          }
        }
      }
      return count;
    },
  };
}

function setVisibleEditors(editors) {
  visibleTextEditors = editors;
}

module.exports = { stub, fakeDocument, fakeEditor, setVisibleEditors };
