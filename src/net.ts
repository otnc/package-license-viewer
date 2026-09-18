import { getConfig } from "./config";
import { log } from "./log";
import type { CancellationLike } from "./providers/types";

/** The registry answered 404, i.e. the package or version does not exist */
export class NotFoundError extends Error {
  constructor(url: string) {
    super(`not found: ${url}`);
    this.name = "NotFoundError";
  }
}

/**
 * GET some JSON, honouring the configured timeout and the cancellation token.
 * 404 is surfaced as NotFoundError so callers can cache the negative result.
 */
export async function fetchJson<T>(
  url: string,
  token: CancellationLike,
  accept = "application/json"
): Promise<T> {
  const timeoutMs = getConfig().requestTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const cancelSub = token.onCancellationRequested(() => controller.abort(new Error("cancelled")));

  try {
    log.debug(`GET ${url}`);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: accept,
        "User-Agent": "vscode-package-license-viewer",
      },
    });

    if (response.status === 404) {
      throw new NotFoundError(url);
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
    cancelSub.dispose();
  }
}

/** Run tasks with a ceiling on how many are in flight at once */
export async function runWithConcurrency<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  limit: number
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const index = next++;
      await tasks[index]();
    }
  });
  await Promise.all(workers);
}
