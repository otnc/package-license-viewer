import { TtlCache } from "../../ttlCache";
import type { FileSystemLike, UriLike } from "../types";
import { joinUriPath } from "../uri";
import { parseManifest, type CargoManifest } from "./parse";

/** How long an auxiliary manifest read is reused before being read again */
const CACHE_TTL_MS = 5000;
/** Upper bound so a deep workspace search cannot grow this without limit */
const MAX_CACHE_ENTRIES = 500;

type ReadResult = { kind: "found"; text: string } | { kind: "missing" } | { kind: "failed" };
export type RootResult =
  { kind: "found"; uri: UriLike; manifest: CargoManifest } | { kind: "unknown"; reason: string };

/** Resolve manifest paths in the document's filesystem, preserving its URI identity. */
export function workspaceManifestUri(directory: UriLike, reference: string): UriLike | undefined {
  const drive = /^\/[A-Za-z]:/.exec(directory.path)?.[0];
  const absoluteDrive = /^[A-Za-z]:[\\/]/.test(reference);
  // Drive-relative and UNC/device paths need filesystem context we do not infer.
  if ((/^[A-Za-z]:/.test(reference) && !absoluteDrive) || reference.startsWith("\\\\"))
    return undefined;
  const path = drive || absoluteDrive ? reference.replace(/\\/g, "/") : reference;
  if ((drive || absoluteDrive) && path.startsWith("//")) return undefined;
  const root = absoluteDrive
    ? directory.with({ path: `/${path}` })
    : path.startsWith("/")
      ? directory.with({ path: `${drive ?? ""}${path}` })
      : joinUriPath(directory, path);
  return joinUriPath(root, "Cargo.toml");
}

/** Short-lived auxiliary reads. Refresh invalidates promises without letting old reads repopulate them. */
export class CargoWorkspace {
  private readonly files = new TtlCache<Promise<ReadResult>>(CACHE_TTL_MS, MAX_CACHE_ENTRIES);
  /**
   * The last parse of each ancestor Cargo.toml `root()` has read, reused as long as its text has
   * not changed. Without this, resolving every dependency of every member of a large workspace
   * re-parses the same root manifest (and any Cargo.toml in between) from scratch on every single
   * one of them, since `root()` runs once per `resolve()` call. Bounded by how many distinct
   * Cargo.toml files this walk has ever read, the same as `files` above.
   */
  private readonly manifests = new Map<
    string,
    { readonly text: string; readonly manifest: CargoManifest | undefined }
  >();

  constructor(private readonly fs: FileSystemLike) {}

  invalidate(): void {
    this.files.clear();
    this.manifests.clear();
  }

  private parsedManifest(uri: UriLike, text: string): CargoManifest | undefined {
    const key = uri.toString();
    const cached = this.manifests.get(key);
    if (cached && cached.text === text) {
      return cached.manifest;
    }
    const manifest = parseManifest(text, key);
    this.manifests.set(key, { text, manifest });
    return manifest;
  }

  read(uri: UriLike): Promise<ReadResult> {
    const key = uri.toString();
    const cached = this.files.get(key);
    if (cached) return cached.value;
    const result = this.fs
      .readFile(uri)
      .then(
        (bytes): ReadResult => ({
          kind: "found",
          text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        }),
        (error: unknown): ReadResult => ({
          kind:
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT"
              ? "missing"
              : "failed",
        })
      )
      .then(
        (value) => value,
        (): ReadResult => ({ kind: "failed" })
      );
    this.files.set(key, result);
    return result;
  }

  async root(uri: UriLike, current: CargoManifest): Promise<RootResult> {
    if (current.invalidWorkspace) return { kind: "unknown", reason: "invalid workspace reference" };
    if (current.workspace) return { kind: "found", uri, manifest: current };
    const directory = joinUriPath(uri, "..");
    if (current.workspacePath !== undefined) {
      const target = workspaceManifestUri(directory, current.workspacePath);
      if (!target) return { kind: "unknown", reason: "unsupported workspace path" };
      const read = await this.read(target);
      const manifest = read.kind === "found" ? this.parsedManifest(target, read.text) : undefined;
      return manifest?.workspace && !manifest.invalidWorkspace
        ? { kind: "found", uri: target, manifest }
        : { kind: "unknown", reason: "explicit workspace root could not be read" };
    }
    let dir = joinUriPath(directory, "..");
    if (dir.path === directory.path) return { kind: "found", uri, manifest: current };
    for (let depth = 0; depth < 64 && dir.path !== directory.path; depth++) {
      const target = joinUriPath(dir, "Cargo.toml");
      const read = await this.read(target);
      if (read.kind === "failed")
        return { kind: "unknown", reason: "workspace ancestor could not be read" };
      if (read.kind === "found") {
        const manifest = this.parsedManifest(target, read.text);
        if (!manifest || manifest.invalidWorkspace)
          return { kind: "unknown", reason: "invalid ancestor manifest" };
        if (manifest.workspace) return { kind: "found", uri: target, manifest };
      }
      const parent = joinUriPath(dir, "..");
      if (parent.path === dir.path) return { kind: "found", uri, manifest: current };
      dir = parent;
    }
    return { kind: "unknown", reason: "workspace ancestor search limit reached" };
  }
}
