import * as vscode from "vscode";
import type { FileSystemLike, ProviderHost, UriLike } from "./providers/types";

/** Adapts `vscode.workspace.fs` to `FileSystemLike`, normalizing a missing file to Node's `ENOENT` convention instead of vscode's own `FileNotFound`. */
export const vscodeFileSystem: FileSystemLike = {
  async readFile(uri: UriLike): Promise<Uint8Array> {
    try {
      return await vscode.workspace.fs.readFile(uri as vscode.Uri);
    } catch (error) {
      throw normalizeMissing(error);
    }
  },
  async stat(uri: UriLike): Promise<{ size: number }> {
    try {
      return await vscode.workspace.fs.stat(uri as vscode.Uri);
    } catch (error) {
      throw normalizeMissing(error);
    }
  },
};

/** The `ProviderHost` every provider runs against inside the VS Code extension. */
export const vscodeProviderHost: ProviderHost = {
  fs: vscodeFileSystem,
  parseUri: (uri: string): UriLike => vscode.Uri.parse(uri),
};

function normalizeMissing(error: unknown): unknown {
  const code =
    typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return code === "FileNotFound" ? Object.assign(new Error("ENOENT"), { code: "ENOENT" }) : error;
}
