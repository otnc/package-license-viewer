import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const readState = async (file: string): Promise<Record<string, unknown>> => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
};

/**
 * Creates the on-disk storage used by LicenseCache for a single manifest.
 * @example
 * const cache = new LicenseCache(await openCacheState("/project/package.json"));
 */
export const openCacheState = async (manifest: string) => {
  const root = process.env.XDG_CACHE_HOME || process.env.LOCALAPPDATA || join(homedir(), ".cache");
  const key = createHash("sha256").update(manifest).digest("hex");
  const file = join(root, "package-license-viewer", "cli", key + ".json");
  const state = await readState(file);
  let pendingWrite = Promise.resolve();

  return {
    get: <T>(key: string, fallback?: T) => (state[key] as T | undefined) ?? fallback,
    keys: () => Object.keys(state),
    update: (key: string, value: unknown) => {
      state[key] = value;
      const snapshot = JSON.stringify(state);
      // LicenseCache may flush while a previous asynchronous write is still in flight.
      const write = pendingWrite.then(async () => {
        const temporary = file + "." + randomUUID() + ".tmp";
        await mkdir(dirname(file), { recursive: true });
        try {
          await writeFile(temporary, snapshot, { mode: 0o600 });
          // Readers in other CLI processes only see complete snapshots.
          await rename(temporary, file);
        } finally {
          await rm(temporary, { force: true });
        }
      });
      pendingWrite = write.catch(() => {});
      return write;
    },
  };
};
