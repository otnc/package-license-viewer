import * as vscode from "vscode";
import { getConfig } from "./config";
import { log } from "./log";

const STORAGE_KEY = "packageLicenseViewer.cache.v1";
/** Upper bound so globalState does not grow without limit */
const MAX_ENTRIES = 5000;

interface CacheRecord<T> {
  /** When it was stored, epoch ms */
  t: number;
  /** The value */
  v: T;
}

/**
 * Two-level cache: in memory, backed by globalState.
 * Writes are debounced and flushed together.
 */
export class LicenseCache {
  private memory = new Map<string, CacheRecord<unknown>>();
  private flushTimer: NodeJS.Timeout | undefined;
  private dirty = false;

  constructor(private readonly state: vscode.Memento) {
    const stored = state.get<Record<string, CacheRecord<unknown>>>(STORAGE_KEY);
    if (stored) {
      for (const [key, record] of Object.entries(stored)) {
        this.memory.set(key, record);
      }
      log.debug(`cache: loaded ${this.memory.size} entries`);
    }
  }

  get<T>(key: string): T | undefined {
    const record = this.memory.get(key) as CacheRecord<T> | undefined;
    if (!record) {
      return undefined;
    }
    const ttlMs = getConfig().cacheTtlHours * 60 * 60 * 1000;
    if (ttlMs > 0 && Date.now() - record.t > ttlMs) {
      this.memory.delete(key);
      this.dirty = true;
      return undefined;
    }
    return record.v;
  }

  set<T>(key: string, value: T): void {
    this.memory.set(key, { t: Date.now(), v: value });
    this.dirty = true;
    this.scheduleFlush();
  }

  clear(): void {
    this.memory.clear();
    this.dirty = true;
    void this.flush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush();
    }, 2000);
  }

  async flush(): Promise<void> {
    if (!this.dirty) {
      return;
    }
    this.dirty = false;

    if (getConfig().cacheTtlHours <= 0) {
      await this.state.update(STORAGE_KEY, undefined);
      return;
    }

    // Over the limit: drop the oldest entries
    if (this.memory.size > MAX_ENTRIES) {
      const sorted = [...this.memory.entries()].sort((a, b) => b[1].t - a[1].t);
      this.memory = new Map(sorted.slice(0, MAX_ENTRIES));
    }

    const plain: Record<string, CacheRecord<unknown>> = {};
    for (const [key, record] of this.memory) {
      plain[key] = record;
    }
    try {
      await this.state.update(STORAGE_KEY, plain);
    } catch (error) {
      log.warn(`cache: failed to persist: ${String(error)}`);
    }
  }

  dispose(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    void this.flush();
  }
}
