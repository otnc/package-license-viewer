import { expect, test, vi } from "vitest";
import { TtlCache } from "../src/ttlCache";

test("returns undefined for a key that was never set", () => {
  const cache = new TtlCache<string>(1000, 10);
  expect(cache.get("missing")).toBeUndefined();
});

test("distinguishes a cached falsy value from a cache miss", () => {
  const cache = new TtlCache<string | undefined>(1000, 10);
  cache.set("negative", undefined);
  expect(cache.get("negative")).toEqual({ value: undefined });
  expect(cache.get("never-set")).toBeUndefined();
});

test("expires an entry once its TTL has passed", () => {
  vi.useFakeTimers();
  try {
    const cache = new TtlCache<string>(1000, 10);
    cache.set("key", "value");
    vi.advanceTimersByTime(999);
    expect(cache.get("key")).toEqual({ value: "value" });
    vi.advanceTimersByTime(2);
    expect(cache.get("key")).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

test("evicts the least-recently-set entry once maxEntries is exceeded", () => {
  const cache = new TtlCache<number>(60_000, 2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);

  expect(cache.get("a")).toBeUndefined();
  expect(cache.get("b")).toEqual({ value: 2 });
  expect(cache.get("c")).toEqual({ value: 3 });
});

test("re-setting an existing key refreshes its recency instead of evicting it early", () => {
  const cache = new TtlCache<number>(60_000, 2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("a", 10);
  cache.set("c", 3);

  expect(cache.get("a")).toEqual({ value: 10 });
  expect(cache.get("b")).toBeUndefined();
  expect(cache.get("c")).toEqual({ value: 3 });
});
