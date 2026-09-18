# Change Log

## [0.5.0]

### Added

- MoonBitのライセンスプロバイダを追加


### Fixed

- MoonBitのバージョン検証をディスク上の解決より後ろに移す

## [0.4.0]

### Added

- Add .private to .gitignore
- Add eslint
- Add issue templates for bug reports and feature requests
- Parse Cargo dependency declarations and version requirements
- Resolve Cargo license metadata from workspace and lockfile hints
- Add Cargo license annotations


### Fixed

- Retry cancelled shared lookups for active annotation updates
- Resolve absolute Cargo workspace paths without changing URI identity
- Reuse cached version lists for locked Cargo metadata
- Prevent invalidated annotation lookups from restoring stale results
- Recognize crates.io package IDs in root replacements
- Reject mixed-separator Windows UNC workspace references
- Recognize trailing slashes in crates.io patch URLs
- Preserve metadata expiry when reusing cached crate versions
- Cancel pending annotation updates when display is disabled
- Crates.ioのクレート名表記ゆれと不正なバージョンレコードへの対応
- Unknown解決結果でもResolved fromに取得経路(via)を表示する

## [0.3.1]

### Fixed

- Hovering an annotation could show the same tooltip content repeated two or three times. Splitting the license into its own color (0.3.0) draws it across up to four decorations sharing one position, and all of them ended up carrying the same hover message — VS Code shows one hover section per decoration at a given position, so it appeared once per piece instead of once overall.

## [0.3.0]

### Added

- The license part of the annotation is now drawn in its own color (`charts.green` by default) instead of the same dimmed color as the rest of the line, so it stands out at a glance. New `packageLicenseViewer.licenseColor` setting controls it independently of `packageLicenseViewer.annotationColor`, which now covers everything else (the version, source, and `Node: ...` text).

## [0.2.2]

- Fix some repository URLs.

## [0.2.1]

### Added

- A package's declared `engines.node` range is now also appended to the inline annotation, not just shown in the hover, e.g. `MIT (Node: >=20)`. New `packageLicenseViewer.showNodeEngine` setting (default `true`) turns it off, and a new `${nodeEngine}` placeholder is available for `packageLicenseViewer.format` ([#4]).

## [0.2.0]

### Added

- `pnpm-workspace.yaml` is now annotated directly: the `catalog:` (default) and `catalogs:` (named) sections list the actual ranges a workspace catalog resolves to, and those get the same inline license annotation and hover as any other dependency ([#3]).
- The hover now shows a package's declared `engines.node` range right after its license, when it has one ([#4]).

### Fixed

- pnpm workspace catalog dependencies (`"typescript": "catalog:"`, or a named catalog such as `"catalog:build"`) never resolved: the specifier was misclassified the same way as `file:`/`workspace:`/git dependencies and skipped before ever reaching the lockfile, even though `pnpm-lock.yaml`'s `importers` section records exactly what a catalog reference resolved to. It is now read from there like any other pinned version ([#1], reported by [@otnc](https://github.com/otnc)).
- A `catalog:` dependency resolved straight from an installed `node_modules` package (rather than through the lockfile) lost its hover link to npmjs.org, because `registryPackageName` was only ever set on the lockfile path ([#2], reported by [@otnc](https://github.com/otnc)).

[#1]: https://github.com/otnc/package-license-viewer/issues/1
[#2]: https://github.com/otnc/package-license-viewer/issues/2
[#3]: https://github.com/otnc/package-license-viewer/issues/3
[#4]: https://github.com/otnc/package-license-viewer/issues/4

## [0.1.3]

- Miss.
- Deprecated.

## [0.1.2]

### Added

- `package.json` now understands the native `jsr:` specifier pnpm >=10.9 and Yarn >=4.9 write for JSR packages — both `"@scope/name": "jsr:^1.0.0"` (bare) and `"alias": "jsr:@scope/name@^1.0.0"` (aliased). Verified against a real `pnpm add jsr:@luca/cases`.
- The hover title now links to `https://www.npmjs.com/package/<name>/v/<version>` for dependencies that really are npm registry packages — including following an `npm:` alias to its real target rather than linking the local package.json key. JSR packages link to their own JSR page (`https://jsr.io/@scope/name@version`) instead, never to npmjs.org, since they are never published there under their JSR or npm-compatibility name.

### Fixed

- JSR packages installed through the `@jsr` npm-compatibility layer (either the `@jsr/scope__name` alias or the new native `jsr:` specifier) never got a license when they were already installed: the npm-compatibility `package.json` in `node_modules` never carries a `license` field — confirmed true even for `@std/fs`, which does declare MIT on JSR itself — but the resolver returned "no license field" without ever asking jsr.io. It now falls back to jsr.io for the license of the exact version already on disk.
- The hover title (`package@1.2.3`) was rendered as a `mailto:` link. `name@1.2.3` is a syntactically valid GFM extended email autolink — numeric domain labels are allowed, so `4.17.21` parses as one — and VS Code's hover renderer (`marked`) autolinks it accordingly unless it sits inside a code span. Verified directly against `marked`.

## [0.1.1]

- Fix some bugs.

## [0.1.0]

Initial release.

### Inline license annotations

- Dimmed license at the end of each dependency line, with a hover showing the resolved version, the source of the information and the package homepage.
- `package.json`: `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies` and any other `*Dependencies` section.
- `deno.json`, `deno.jsonc`, `jsr.json`, `import_map.json`: `imports`, for both `jsr:` and `npm:` specifiers.

### Resolution

- `node_modules` first — offline, hoisting and monorepo aware. Verified against npm, pnpm, yarn classic, yarn berry (`nodeLinker: node-modules`) and bun.
- Lockfiles second, for the exact pinned version: `package-lock.json` (v1/v2/v3, workspaces), `npm-shrinkwrap.json`, `pnpm-lock.yaml` (v5/v6/v9), `yarn.lock` (classic and berry), `bun.lock`. This is what makes Yarn PnP and not-yet-installed workspaces work. `package-lock.json` carries the license itself, so npm projects resolve with no network access at all.
- Registries last: `registry.npmjs.org` and `jsr.io`. `npm:` aliases are followed, and `@jsr/scope__name` is routed to JSR.
- Unresolvable specifiers (`file:`, `link:`, `workspace:`, git, tarball URLs) are left un-annotated instead of being marked unknown.

### Infrastructure

- Two-level cache (in-memory + on-disk) with a configurable TTL, request cancellation, a concurrency limit, and flicker-free redrawing while typing.
- Provider-based architecture so other ecosystems can be added by implementing one interface.
- CI, an integration suite that runs the extension inside a real VS Code, and a manually triggered release workflow that publishes to the VS Code Marketplace.

### Fixed before the first release

- Only some dependencies were annotated, and they took a while to appear. Opening a manifest fires activation and two editor events in a burst; each update cancelled the previous one, and because in-flight resolutions are shared by cache key, a newer update ended up waiting on a promise created by an older, now-cancelled one. The answer arrived correctly and was then discarded purely because the first caller's token had been cancelled. On this repository's own `package.json` that meant 4 of 12 licenses were drawn and the rest never were; now all 12 are drawn within about 55ms of opening the file.
- The bundled extension failed to load at all: `jsonc-parser`'s `main` is a UMD file whose inner `require()` calls esbuild cannot follow, so they survived into the bundle and threw inside the extension host. esbuild now prefers the `module` entry point, and both the unit and integration suites load the real bundle so this cannot regress silently.

### Known limitations

- JSR reports a license only for packages that declared one; the API returns `null` otherwise.
- `deno.lock` is not read, so `jsr:` ranges resolve against the registry.
- `bun.lockb` (the binary lockfile) is not parsed; bun's `node_modules` covers that case.
