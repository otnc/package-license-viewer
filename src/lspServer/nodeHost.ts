import { readFile, stat } from "node:fs/promises";
import type { FileSystemLike, ProviderHost, UriLike } from "../providers/types";

function makeUri(scheme: string, authority: string, path: string): UriLike {
  return {
    scheme,
    authority,
    path,
    toString: () => (scheme ? `${scheme}://${authority}${path}` : path),
    with: (change: { path?: string }) => makeUri(scheme, authority, change.path ?? path),
  };
}

/** Parses a `scheme://authority/path` URI string, or treats it as a bare path when there's no scheme. */
export function parseUri(value: string): UriLike {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/]*)(\/.*)?$/.exec(value);
  return match ? makeUri(match[1], match[2], match[3] ?? "") : makeUri("", "", value);
}

/** `file://` URI path to a real filesystem path — handles the leading slash before a Windows drive letter. */
function toFsPath(uri: UriLike): string {
  const decoded = decodeURIComponent(uri.path);
  return /^\/[A-Za-z]:/.test(decoded) ? decoded.slice(1) : decoded;
}

const nodeFileSystem: FileSystemLike = {
  async readFile(uri: UriLike): Promise<Uint8Array> {
    return new Uint8Array(await readFile(toFsPath(uri)));
  },
  async stat(uri: UriLike): Promise<{ size: number }> {
    const info = await stat(toFsPath(uri));
    return { size: info.size };
  },
};

/** The `ProviderHost` every provider runs against inside the LSP server — Node's `fs/promises` instead of `vscode.workspace.fs`, and a plain URI parser instead of `vscode.Uri.parse`. Node's own `ENOENT` is already the convention `FileSystemLike` expects, so nothing needs normalizing here (contrast `src/vscodeFs.ts`). */
export const nodeProviderHost: ProviderHost = {
  fs: nodeFileSystem,
  parseUri,
};
