import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { LicenseProvider } from "@plv/core";

type CustomProvider = Pick<LicenseProvider, "supports" | "parse" | "resolve">;

const isCustomProvider = (value: unknown): value is CustomProvider =>
  typeof value === "object" &&
  value !== null &&
  "supports" in value &&
  typeof value.supports === "function" &&
  "parse" in value &&
  typeof value.parse === "function" &&
  "resolve" in value &&
  typeof value.resolve === "function";

/**
 * Loads trusted local provider modules in command-line order. Paths are relative to the working directory.
 * @example
 * const providers = await loadCustomProviders(["./licenses.mjs"]);
 */
export const loadCustomProviders = async (paths: readonly string[]) => {
  const providers: CustomProvider[] = [];
  for (const path of paths) {
    if (!path.trim()) throw new Error("--provider requires a module path.");
    const url = pathToFileURL(resolve(path));
    const module = await import(url.href).catch((error: Error) => {
      throw new Error(`Cannot load provider ${path}: ${error.message}`, { cause: error });
    });
    const provider: unknown = module.default;
    if (!isCustomProvider(provider)) {
      throw new Error(
        `Provider ${path} must default-export an object with supports, parse, and resolve methods.`
      );
    }
    providers.push(provider);
  }
  return providers;
};
