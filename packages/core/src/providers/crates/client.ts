import type { LicenseCache } from "../../cache";
import { getSetting } from "../../config";
import { fetchJson } from "../../net";
import { CancellationTokenSource } from "../cancellation";
import type { CancellationLike } from "../types";
import { record } from "./parse";
import { compareVersions, matchesRequirement, validVersion, type Requirement } from "./spec";

export interface CrateVersion {
  version: string;
  license?: string;
  homepage?: string;
  yanked: boolean;
}
export type MetadataResult =
  { kind: "found"; metadata: CrateVersion } | { kind: "unknown"; reason: string };

/** crates.io treats "-" and "_" as the same crate identity, so compare names that way too. */
function normalizeCrateName(name: string): string {
  return name.replace(/_/g, "-");
}

function decodeVersion(value: unknown, name: string): CrateVersion {
  if (
    !record(value) ||
    typeof value.crate !== "string" ||
    normalizeCrateName(value.crate) !== normalizeCrateName(name) ||
    typeof value.num !== "string" ||
    !validVersion(value.num) ||
    typeof value.yanked !== "boolean" ||
    (value.license != null && typeof value.license !== "string") ||
    (value.homepage != null && typeof value.homepage !== "string")
  )
    throw new Error("invalid crates.io version metadata");
  return {
    version: value.num,
    license: typeof value.license === "string" ? value.license.trim() || undefined : undefined,
    homepage: typeof value.homepage === "string" ? value.homepage : undefined,
    yanked: value.yanked,
  };
}

function checkCancelled(token: CancellationLike): void {
  if (token.isCancellationRequested) throw new Error("cancelled");
}

function wait(ms: number, token: CancellationLike): Promise<void> {
  checkCancelled(token);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.dispose();
      resolve();
    }, ms);
    const sub = token.onCancellationRequested(() => {
      clearTimeout(timer);
      sub.dispose();
      reject(new Error("cancelled"));
    });
  });
}

/** Shared across all Cargo clients in this extension host; spaces actual send starts. */
export class CratesRateLimiter {
  private tail: Promise<void> = Promise.resolve();
  private nextStart = 0;

  run<T>(token: CancellationLike, send: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      checkCancelled(token);
      while (Date.now() < this.nextStart) await wait(this.nextStart - Date.now(), token);
      checkCancelled(token);
      if (!getSetting("crates.useRegistry", true)) throw new Error("registry lookups disabled");
      this.nextStart = Date.now() + 1000;
      try {
        return await send();
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("HTTP 429 "))
          this.nextStart = Math.max(this.nextStart, Date.now() + 60_000);
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
const limiter = new CratesRateLimiter();
interface Pending {
  promise: Promise<unknown>;
  cts: CancellationTokenSource;
  users: number;
}

export class CratesClient {
  private readonly pending = new Map<string, Pending>();
  private epoch = 0;
  constructor(private readonly cache: LicenseCache) {}

  invalidate(): void {
    this.epoch++;
    for (const pending of this.pending.values()) {
      pending.cts.cancel();
    }
    this.pending.clear();
  }

  private async json(url: string, token: CancellationLike): Promise<unknown> {
    checkCancelled(token);
    let pending = this.pending.get(url);
    if (!pending) {
      const cts = new CancellationTokenSource();
      const promise = limiter.run(cts.token, () => fetchJson<unknown>(url, cts.token));
      pending = { promise, cts, users: 0 };
      this.pending.set(url, pending);
      const captured = pending;
      void promise
        .finally(() => {
          if (this.pending.get(url) === captured) this.pending.delete(url);
          cts.dispose();
        })
        .catch(() => {});
    }
    const shared = pending;
    shared.users++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (--shared.users === 0) {
        shared.cts.cancel();
        if (this.pending.get(url) === shared) this.pending.delete(url);
      }
    };
    return new Promise((resolve, reject) => {
      const sub = token.onCancellationRequested(() => {
        release();
        reject(new Error("cancelled"));
      });
      shared.promise.then(resolve, reject).finally(() => {
        sub.dispose();
        release();
      });
    });
  }

  async metadata(
    name: string,
    requirement: Requirement,
    locked: string | undefined,
    token: CancellationLike
  ): Promise<MetadataResult> {
    const epoch = this.epoch;
    const key = (v: string) => `crates:metadata:v1:${name}@${v}`;
    const listKey = `crates:versions:v1:${name}`;
    try {
      checkCancelled(token);
      const cached = locked
        ? (this.cache.get<CrateVersion>(key(locked)) ??
          this.cache.get<CrateVersion[]>(listKey)?.find((metadata) => metadata.version === locked))
        : undefined;
      if (cached) return { kind: "found", metadata: cached };
      let selected: CrateVersion | undefined;
      let fetched = false;
      if (locked) {
        if (!getSetting("crates.useRegistry", true))
          return { kind: "unknown", reason: "registry disabled; Cargo.lock carries no license" };
        const json = await this.json(
          `https://crates.io/api/v1/crates/${encodeURIComponent(name)}/${encodeURIComponent(locked)}`,
          token
        );
        selected = decodeVersion(record(json) ? json.version : undefined, name);
        if (selected.version !== locked) throw new Error("crates.io returned a different version");
        fetched = true;
      } else {
        let versions = this.cache.get<CrateVersion[]>(listKey);
        if (!versions) {
          if (!getSetting("crates.useRegistry", true))
            return { kind: "unknown", reason: "registry disabled and no cached public versions" };
          // Without per_page this endpoint returns ALL versions, by its documented compatibility contract.
          const json = await this.json(
            `https://crates.io/api/v1/crates/${encodeURIComponent(name)}/versions`,
            token
          );
          if (
            !record(json) ||
            !Array.isArray(json.versions) ||
            (record(json.meta) && json.meta.next_page != null)
          )
            throw new Error("incomplete crates.io version list");
          // A single malformed record (unexpected crates.io response shape, name-mismatch, ...)
          // should not throw away every other version this crate actually has.
          const decoded = json.versions.flatMap((v) => {
            try {
              return [decodeVersion(v, name)];
            } catch {
              return [];
            }
          });
          // ...but if nothing decoded at all from a non-empty response, that's a sign the
          // response itself is wrong (e.g. an unexpected shape), not that the crate has zero
          // versions — don't cache that as a confirmed-empty result, retry next time instead.
          if (decoded.length === 0 && json.versions.length > 0)
            throw new Error("no version record could be decoded");
          versions = decoded;
          fetched = true;
          checkCancelled(token);
          if (epoch === this.epoch) this.cache.set(listKey, versions);
        }
        selected = versions
          .filter((v) => !v.yanked && matchesRequirement(requirement, v.version))
          .sort((a, b) => compareVersions(b.version, a.version))[0];
      }
      checkCancelled(token);
      if (!selected) return { kind: "unknown", reason: "no matching non-yanked public version" };
      // Reusing a cached list must not renew an exact version's metadata lifetime.
      if (fetched && epoch === this.epoch) this.cache.set(key(selected.version), selected);
      return { kind: "found", metadata: selected };
    } catch (error) {
      return {
        kind: "unknown",
        reason: token.isCancellationRequested
          ? "cancelled"
          : `crates.io lookup failed: ${String(error)}`,
      };
    }
  }
}
