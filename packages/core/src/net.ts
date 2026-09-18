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

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function checkCancelled(token: CancellationLike): void {
  if (token.isCancellationRequested) throw new Error("cancelled");
}

/** Resolves after `ms`, or rejects as soon as `token` is cancelled — whichever comes first. */
export function wait(ms: number, token: CancellationLike): Promise<void> {
  checkCancelled(token);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      resolve();
    }, ms);
    const subscription = token.onCancellationRequested(() => {
      clearTimeout(timer);
      subscription.dispose();
      reject(new Error("cancelled"));
    });
  });
}

/**
 * Serializes requests from every client sharing one instance, spacing sends `spacingMs` apart and
 * backing off for `backoffMs` without retrying whenever the registry answers 429 — the pattern
 * crates.io and mooncakes.io clients both need to stay gentle against a registry that publishes
 * no rate limit of its own.
 */
export class RequestLimiter {
  private tail: Promise<void> = Promise.resolve();
  private nextStart = 0;

  constructor(
    private readonly spacingMs: number,
    private readonly backoffMs: number,
    private readonly isEnabled: () => boolean
  ) {}

  run<T>(token: CancellationLike, send: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      checkCancelled(token);
      while (Date.now() < this.nextStart) await wait(this.nextStart - Date.now(), token);
      checkCancelled(token);
      if (!this.isEnabled()) throw new Error("registry lookups disabled");
      this.nextStart = Date.now() + this.spacingMs;
      try {
        return await send();
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("HTTP 429 "))
          this.nextStart = Math.max(this.nextStart, Date.now() + this.backoffMs);
        throw error;
      }
    });
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
