import type { FileSystemLike, ProviderHost, UriLike } from "../../src/providers/types";

function makeUri(scheme: string, authority: string, path: string): UriLike {
  return {
    scheme,
    authority,
    path,
    toString: () => (scheme ? `${scheme}://${authority}${path}` : path),
    with: (change) => makeUri(scheme, authority, change.path ?? path),
  };
}

/** `scheme://authority/path`, or a bare path when there's no scheme — the same rule packages/lsp-server/src/nodeHost.ts uses for a real editor, duplicated here so these tests need nothing from that package. */
function parseUri(value: string): UriLike {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/]*)(\/.*)?$/.exec(value);
  return match ? makeUri(match[1], match[2], match[3] ?? "") : makeUri("", "", value);
}

/** A `UriLike` for a bare path, e.g. for calling a provider's `supports()` directly without a full fake document. */
export function fakeUri(path: string): UriLike {
  return makeUri("", "", path);
}

/** A minimal `vscode.CancellationTokenSource` stand-in — just enough of `CancellationLike`. */
export class FakeCancellationTokenSource {
  private cancelled = false;
  private readonly listeners: (() => void)[] = [];
  readonly token = {
    isCancellationRequested: false,
    onCancellationRequested: (listener: (e: unknown) => unknown) => {
      this.listeners.push(() => listener(undefined));
      return { dispose: () => {} };
    },
  };

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.token.isCancellationRequested = true;
    for (const listener of this.listeners) listener();
  }
}

/**
 * An in-memory `ProviderHost` keyed by URI path — for tests that need a filesystem but not a real
 * one. `files` is read live, so a test can keep its own `Map` reference and call `.set()`/`.delete()`
 * mid-test to change what's "on disk".
 */
export function fakeHost(files: Record<string, string> | Map<string, string> = {}): ProviderHost {
  const map = files instanceof Map ? files : new Map(Object.entries(files));
  const notFound = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  const fs: FileSystemLike = {
    async readFile(uri) {
      const text = map.get(uri.path);
      if (text === undefined) throw notFound();
      return new TextEncoder().encode(text);
    },
    async stat(uri) {
      const text = map.get(uri.path);
      if (text === undefined) throw notFound();
      return { size: new TextEncoder().encode(text).length };
    },
  };
  return { fs, parseUri };
}

/** Same leading-slash-before-a-drive-letter convention `vscode.Uri.file()` uses, so a fixture path written as `"d:/project/x"` behaves identically here. */
export function fakePath(fsPath: string): string {
  return "/" + fsPath.replace(/\\/g, "/").replace(/^\//, "");
}

/** The smallest thing that satisfies `TextDocumentLike`. */
export function fakeDocument(text: string, fsPath = "/project/package.json") {
  const uri = fakePath(fsPath);
  const lines = text.split("\n");
  return {
    uri,
    getText: () => text,
    lineCount: lines.length,
    positionAt(offset: number) {
      let remaining = offset;
      let line = 0;
      while (line < lines.length && remaining > lines[line].length) {
        remaining -= lines[line].length + 1;
        line++;
      }
      return { line, character: remaining };
    },
    lineAt: (index: number) => ({ text: lines[index] ?? "" }),
  };
}
