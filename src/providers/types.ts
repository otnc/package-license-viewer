/**
 * Minimal view of a text document, shaped like `vscode.TextDocument` but without depending on
 * `vscode` — so a provider's public contract works the same whether the host is VS Code, an LSP
 * server, or a test. VS Code's own `TextDocument` satisfies this once its `uri` is stringified.
 */
export interface TextDocumentLike {
  /** The document's URI as a string, e.g. `file:///path/to/package.json` */
  readonly uri: string;
  getText(): string;
  readonly lineCount: number;
  lineAt(line: number): { readonly text: string };
  /** Convert a character offset into a zero-based line number */
  positionAt(offset: number): { readonly line: number };
}

export interface DisposableLike {
  dispose(): void;
}

/** Minimal view of `vscode.CancellationToken` */
export interface CancellationLike {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: (e: unknown) => unknown): DisposableLike;
}

/** Minimal view of `vscode.Uri` — a real `vscode.Uri` satisfies this as-is. */
export interface UriLike {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  toString(): string;
  with(change: { path?: string }): UriLike;
}

/**
 * Minimal view of `vscode.workspace.fs`, normalized so a missing file always rejects with
 * `code: "ENOENT"` — Node's own convention — regardless of which host implements it. This is
 * what keeps `installed.ts`, `lockfile/index.ts` and `crates/workspace.ts` free of any real
 * filesystem access of their own, so a future non-VS-Code host only has to implement this.
 */
export interface FileSystemLike {
  readFile(uri: UriLike): Promise<Uint8Array>;
  stat(uri: UriLike): Promise<{ readonly size: number }>;
}

/**
 * One dependency taken from a manifest.

 * The shape is deliberately ecosystem-agnostic: adding support for PyPI, crates.io and friends should only mean writing a new provider, never touching the code that renders, schedules or caches.
 */
export interface DependencyEntry {
  /** Package name, e.g. "typescript" or "@types/node" */
  readonly name: string;
  /** The version specifier as written in the manifest, e.g. "^5.7.2" */
  readonly spec: string;
  /** Which group it came from, e.g. "dependencies" or "devDependencies" */
  readonly section: string;
  /** Zero-based line the annotation is drawn on */
  readonly line: number;
}

/** Where a license was read from */
export type LicenseSource =
  /** From a package installed on disk */
  | "local"
  /** From a lockfile — npm's lockfile carries licenses, the others only pin versions */
  | "lockfile"
  /** From a remote registry */
  | "registry"
  /** Deliberately not resolved (git dependency, local path, …) */
  | "skipped"
  /** Resolution was attempted but produced nothing */
  | "unknown";

/** What we managed to find out about one dependency */
export interface LicenseInfo {
  /** An SPDX expression, or undefined when it could not be determined */
  readonly license?: string;
  /** The version the specifier actually resolved to */
  readonly version?: string;
  /** Where the answer came from */
  readonly source: LicenseSource;
  /** Extra context for the hover, typically why nothing was found */
  readonly detail?: string;
  /** Overrides how the hover describes the resolution path, e.g. "pnpm-lock.yaml + registry" */
  readonly via?: string;
  /** URL to link from the hover */
  readonly homepage?: string;
  /** The package's declared `engines.node` range, e.g. `">=18.0.0"`, shown right after the license */
  readonly nodeEngine?: string;
  /**
   * The exact name to look this package up as on npmjs.org, when it really is one — e.g. the alias target of an `npm:` specifier, not the local package.json key. Left unset for JSR packages: they are never published to npmjs.org under their JSR or npm-compatibility name, so a link there would 404. Used to link the hover title to `https://www.npmjs.com/package/<name>/v/<version>`.
   */
  readonly registryPackageName?: string;
  /**
   * The exact URL to link the hover title to, for registries whose package page isn't an `npmjs.org/package/<name>/v/<version>` path — currently just JSR (`https://jsr.io/@scope/name@version`). Ignored when `registryPackageName` is also set, since that always wins for a genuine npm package.

   * Any future provider (PyPI, crates.io, …) should set this the same way — a clickable hover title is expected of every registry, not just JSR. See CONTRIBUTING.md.
   */
  readonly packagePageUrl?: string;
}

/**
 * Resolves licenses for one ecosystem.

 * To support a new language, implement this interface and add the class to `createProviders()` in `providers/index.ts`. Nothing else needs to change.
 */
export interface LicenseProvider {
  /** Unique id, also used to namespace cache keys */
  readonly id: string;

  /** Whether this provider handles the given document (package.json, Cargo.toml, …) */
  supports(document: TextDocumentLike): boolean;

  /** Whether the user has this provider turned on */
  isEnabled(): boolean;

  /** Extract the dependencies from the manifest text */
  parse(document: TextDocumentLike): DependencyEntry[];

  /**
   * A cache key that uniquely identifies this entry.
   * Return undefined when the result must not be cached.
   */
  cacheKey(entry: DependencyEntry): string | undefined;

  /** Resolve the license. May hit the network. */
  resolve(
    entry: DependencyEntry,
    document: TextDocumentLike,
    token: CancellationLike
  ): Promise<LicenseInfo>;
}
