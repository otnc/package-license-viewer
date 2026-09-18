import { posix } from "node:path";
import type { UriLike } from "./types";

/** `vscode.Uri.joinPath`, generalized to any `UriLike` — URI paths are always posix-style, regardless of the host OS. */
export function joinUriPath(base: UriLike, ...pathSegments: string[]): UriLike {
  return pathSegments.length === 0
    ? base
    : base.with({ path: posix.join(base.path, ...pathSegments) });
}

/**
 * Turns an absolute OS filesystem path (e.g. from `os.homedir()` or an environment variable, not
 * a document URI) into a `file://` URI string a host's `parseUri()` understands — the reverse of
 * how a real filesystem path is recovered from a URI. Needed wherever a provider reads from a
 * fixed location on disk instead of walking up from the document being annotated, e.g. moon's own
 * `$MOON_HOME`.
 */
export function fileUriFromPath(absolutePath: string): string {
  const posixPath = absolutePath.replace(/\\/g, "/");
  return `file://${posixPath.startsWith("/") ? "" : "/"}${posixPath}`;
}
