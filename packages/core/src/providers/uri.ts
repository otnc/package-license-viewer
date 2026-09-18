import { posix } from "node:path";
import type { UriLike } from "./types";

/** `vscode.Uri.joinPath`, generalized to any `UriLike` — URI paths are always posix-style, regardless of the host OS. */
export function joinUriPath(base: UriLike, ...pathSegments: string[]): UriLike {
  return pathSegments.length === 0
    ? base
    : base.with({ path: posix.join(base.path, ...pathSegments) });
}
