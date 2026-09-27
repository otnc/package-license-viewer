/**
 * A small in-memory TTL cache with a hard cap on how many entries it holds at once.
 *
 * Several providers keep a short-lived, per-directory or per-name cache (installed package
 * lookups, lockfile indexes, the MoonBit registry index, Cargo workspace auxiliary reads) so that
 * typing does not re-hit the filesystem on every keystroke. Unlike `LicenseCache` they are never
 * persisted, but without a cap a workspace with many packages/directories would still let them
 * grow for as long as the extension host stays open. `set()` evicts the least-recently-set entry
 * once `maxEntries` is exceeded, same as `LicenseCache.flush()` does for its own map.
 */
export class TtlCache<V> {
  private entries = new Map<string, { at: number; value: V }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number
  ) {}

  /**
   * Wrapped in `{ value }` so a cached `undefined`/`null` (a remembered "not found") is still
   * distinguishable from "not cached at all" — unlike `Map.get()`, which cannot tell those apart
   * either, this is exactly the case several callers here rely on.
   */
  get(key: string): { readonly value: V } | undefined {
    const entry = this.entries.get(key);
    if (!entry || Date.now() - entry.at >= this.ttlMs) {
      return undefined;
    }
    return { value: entry.value };
  }

  set(key: string, value: V): void {
    // Delete first so a re-set of an existing key also moves it to the end, keeping insertion
    // order equal to recency order for eviction below.
    this.entries.delete(key);
    this.entries.set(key, { at: Date.now(), value });
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
