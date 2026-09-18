# How license resolution works

This is the detailed reference for how each supported ecosystem resolves a license, moved out of the README to keep that page short. See the README's language/package-manager table for the current support status at a glance.

| Manifest | Sections read |
| --- | --- |
| `package.json` | `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, and any other `*Dependencies` section |
| `deno.json`, `deno.jsonc`, `jsr.json`, `import_map.json` | `imports` — both `jsr:` and `npm:` specifiers |
| `pnpm-workspace.yaml` | `catalog:` and `catalogs:` — the actual ranges a workspace catalog resolves to |
| `Cargo.toml` | `dependencies`, `dev-dependencies`, `build-dependencies`, their target-specific forms, and `workspace.dependencies` |

## npm / JSR

For ordinary npm dependencies in `package.json` and pnpm catalogs:

1. **The installed package, first.** `node_modules/<name>/package.json`, walking up parent directories. Instant, works offline, and reflects the version that is actually installed.
2. **The lockfile.** Gives the exact pinned version even when nothing is installed yet. `package-lock.json` carries the license itself, so npm projects can resolve with **no network access at all**.
3. **The registry.** `registry.npmjs.org` for npm, `jsr.io` for JSR. Results are cached on disk for a week.

Deno/JSR use registry metadata directly.

Specifiers that cannot be resolved — `file:`, `link:`, `workspace:`, `git+…`, `user/repo`, tarball URLs, `https://` imports — are left un-annotated rather than marked unknown. A pnpm workspace catalog reference (`catalog:`, `catalog:<name>`) has no version of its own in `package.json` to resolve against the registry, but `pnpm-lock.yaml` records what it resolved to, so it works wherever the lockfile is readable — and `pnpm-workspace.yaml` itself is annotated too, so the actual range behind a catalog entry is visible right where it's declared. `npm:` aliases are followed to their target. JSR packages inside `package.json` are recognized either way they show up — the npm-compatibility alias `@jsr/scope__name`, or the native `jsr:<range>` / `jsr:@scope/name@<range>` specifier pnpm ≥10.9 and Yarn ≥4.9 write directly — and routed to JSR automatically, since the npm-compatibility registry never publishes a license for them, installed or not.

The hover title links to the npmjs.org package page for dependencies that really are npm registry packages (following an `npm:` alias to its actual target), and to the matching JSR page for JSR packages — never to npmjs.org for those, since they aren't published there under their JSR or npm-compatibility name.

### Package manager layouts

Every layout below was verified by actually installing with that package manager.

| | Layout | How it resolves |
| --- | --- | --- |
| **npm** | hoisted real directories | `node_modules` |
| **yarn classic** | hoisted real directories | `node_modules` |
| **bun** | hoisted real directories | `node_modules` |
| **pnpm** | `node_modules/<name>` symlinks into `node_modules/.pnpm/…` | `node_modules` — reads follow the symlink, and pnpm links exactly the direct dependencies, which is what gets annotated |
| **yarn berry** (`nodeLinker: node-modules`) | real directories | `node_modules` |
| **yarn berry** (PnP) | **no `node_modules` at all** | `yarn.lock` for the pinned version, then the registry for its license |

So no per-package-manager branching is needed for the common case — the only real gap is Yarn PnP, which the lockfile layer covers. The same layer also handles a freshly cloned repository where `npm install` has not run yet.

Lockfile formats understood: `package-lock.json` (v1/v2/v3, including workspaces), `npm-shrinkwrap.json`, `pnpm-lock.yaml` (v5/v6/v9), `yarn.lock` (classic and berry), and `bun.lock`. `bun.lockb` is binary and is skipped — bun installs into `node_modules`, so that path covers it.

### A note on JSR licenses

JSR only exposes a license for a version if the package declared one in its `deno.json` / `jsr.json`. Many packages have not, and for those the API returns `null` — the hover then says _"the package declares no license on JSR"_. This is a gap in the published metadata, not in the lookup; nothing else in JSR's API carries the information (the npm-compatibility endpoint at `npm.jsr.io` does not include a `license` field either).

`deno.lock` is not read yet, so a `jsr:` range resolves against the registry rather than the version pinned in the lockfile.

## Cargo

```toml
[dependencies]
serde = { version = "1", optional = true } # MIT OR Apache-2.0
json = { package = "serde_json", version = "1" }
[dev-dependencies]
tempfile = "3"
```

Comments above illustrate annotations, not changes the extension writes to files. The provider reads dependency declarations, including optional and target-specific declarations regardless of whether they are enabled. Strings, inline tables, dedicated dependency tables, dotted keys and quoted keys are supported using TOML 1.0. An annotation uses the first line of the declaration, or its dedicated table header. Invalid TOML produces no annotations until it is corrected.

`package` aliases are followed to the real crate name. `[workspace.dependencies]` is annotated directly; `workspace = true` inherits the corresponding alias from an explicit `package.workspace` root or the nearest ancestor `[workspace]`. Virtual and nested roots are supported. Relative and absolute workspace paths preserve the document's URI scheme and authority. Windows drive paths and backslash separators are supported; drive-relative and UNC/device references (including forward-slash or mixed UNC separators on Windows) are reported as unknown rather than guessed. This is a limited declaration lookup: members are not enumerated and workspace membership is not fully validated. An unreadable or conflicting reference is unknown, not guessed.

The lookup path is:

1. Look in the root's `Cargo.lock` (or beside a standalone manifest) for a unique version matching the real name, crates.io source and Cargo version requirement.
2. If one is found, request metadata for that exact version, even if yanked. Missing license metadata stays unknown for that version.
3. Otherwise choose the highest non-yanked public version satisfying the Cargo requirement, including Cargo's prerelease rules. A bare `"1.2.3"` is a caret requirement; only `"=1.2.3"` requires that exact version.

Hover links point to the real crate and selected version on crates.io. The `via` description distinguishes `Cargo.lock + crates.io` from `manifest requirement + crates.io`. Both obtain license strings from public registry metadata; **Cargo.lock does not contain licenses**. Cached version metadata is shared across projects, but manifest resolution results are separated by document and dependency source. Requests follow the [crates.io Data Access Policy](https://crates.io/data-access): at most one request per second per extension host, with an identifying User-Agent. An HTTP 429 delays subsequent requests for at least one minute without an automatic retry loop. Offline mode permits cached metadata; Clear License Cache removes it. For a locked version, a matching record in a fresh cached version list is also usable, including yanked versions and records without a license string. No other version is substituted, and reuse does not extend the original cache lifetime.

Path, git and explicitly named registry dependencies are skipped, even if they also specify a version. Their names are not sent to crates.io. Recognized root `patch`/`replace` entries suppress the affected packages conservatively, including renamed patches, without hiding unrelated dependencies. Member patches are ignored when a workspace root is found. `.cargo/config.toml`, source replacement settings and other Cargo configuration are not interpreted.

No Cargo or Rust installation is required. The extension never runs Cargo commands, downloads `.crate` archives, searches the local Cargo source cache, or reads license files. It does not resolve dependency graphs, evaluate features/targets, list transitive dependencies, inspect MSRV or audit licenses. A missing license string means metadata is unavailable, not that use is prohibited. Existing `unknownText` and formatting settings apply; intentionally skipped dependencies remain hidden. **The displayed version is a metadata lookup target, not a guarantee of the version used by an actual build under every Cargo configuration.**

Editing/saving the document, switching editors or Refresh triggers updates. Auxiliary file reads are cached for five seconds and annotation results for one minute; expiration alone does not trigger an update. After an external change to Cargo.lock or a workspace manifest, use Refresh for immediate re-evaluation, or wait for these caches to expire and trigger another editor update. Clear Cache also invalidates auxiliary reads. Cargo setting changes invalidate annotations.

Opening a workspace containing `Cargo.toml` activates the extension even if TOML files are treated as plain text. Opening a standalone file without such a workspace requires a TOML language registration (or running the Refresh command). The extension contributes no TOML grammar or language server. VS Code 1.90 remains the minimum supported version.
