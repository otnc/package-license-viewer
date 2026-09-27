import { afterEach, expect, test } from "vitest";
import { LicenseCache } from "../src/cache";
import { invalidateConfigCache } from "../src/config";
import { setSettings } from "./support/vscodeStub";

function useSettings(settings: Record<string, unknown>): void {
  setSettings(settings);
  invalidateConfigCache();
}

afterEach(() => {
  useSettings({});
});

function memoryMemento() {
  const store: Record<string, unknown> = {};
  return {
    keys: () => Object.keys(store),
    get: <T>(key: string, fallback?: T) => (key in store ? (store[key] as T) : fallback),
    update: async (key: string, value: unknown) => {
      store[key] = value;
    },
  };
}

test("cacheTtlHours = 0 never serves a value, even one set earlier in the same session", () => {
  useSettings({ "packageLicenseViewer.cacheTtlHours": 0 });
  const cache = new LicenseCache(memoryMemento());

  cache.set("lodash@4.17.21", { license: "MIT" });

  expect(cache.get("lodash@4.17.21")).toBeUndefined();
});

test("cacheTtlHours > 0 serves a value set earlier in the same session", () => {
  useSettings({ "packageLicenseViewer.cacheTtlHours": 168 });
  const cache = new LicenseCache(memoryMemento());

  cache.set("lodash@4.17.21", { license: "MIT" });

  expect(cache.get("lodash@4.17.21")).toEqual({ license: "MIT" });
});
