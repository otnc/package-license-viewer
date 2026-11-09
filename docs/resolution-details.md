# How license resolution works

This is the detailed reference for how each supported ecosystem resolves a license, moved out of the README to keep that page short. See the README's language/package-manager table for the current support status at a glance.

| Manifest | Sections read |
| --- | --- |
| `package.json` | `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, and any other `*Dependencies` section |
| `deno.json`, `deno.jsonc`, `jsr.json`, `import_map.json` | `imports` — both `jsr:` and `npm:` specifiers |
| `pnpm-workspace.yaml` | `catalog:` and `catalogs:` — the actual ranges a workspace catalog resolves to |
| `Cargo.toml` | `dependencies`, `dev-dependencies`, `build-dependencies`, their target-specific forms, and `workspace.dependencies` |
| `go.mod` | `require`, single-line and block form, direct and `// indirect` alike, with `replace` applied |
| `Gemfile` | `gem` calls, in and out of `group` blocks |
| `*.gemspec` | `add_dependency`, `add_runtime_dependency`, `add_development_dependency` |
| `composer.json` | `require` and `require-dev`; platform packages (`php`, `ext-*`, `lib-*`, `composer-*-api`) are skipped |

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

Hover links point to the real crate and selected version on crates.io. The `via` description distinguishes `Cargo.lock + crates.io` from `manifest requirement + crates.io`. A version's declared `rust-version` (its MSRV) rides along in the same metadata and is shown after the license the way npm shows `engines.node`, spelled as the minimum it is (`>= 1.56`) — displayed as published, never checked against the workspace's own toolchain. Both obtain license strings from public registry metadata; **Cargo.lock does not contain licenses**. Cached version metadata is shared across projects, but manifest resolution results are separated by document and dependency source. Requests follow the [crates.io Data Access Policy](https://crates.io/data-access): at most one request per second per extension host, with an identifying User-Agent. An HTTP 429 delays subsequent requests for at least one minute without an automatic retry loop. Offline mode permits cached metadata; Clear License Cache removes it. For a locked version, a matching record in a fresh cached version list is also usable, including yanked versions and records without a license string. No other version is substituted, and reuse does not extend the original cache lifetime.

Path, git and explicitly named registry dependencies are skipped, even if they also specify a version. Their names are not sent to crates.io. Recognized root `patch`/`replace` entries suppress the affected packages conservatively, including renamed patches, without hiding unrelated dependencies. Member patches are ignored when a workspace root is found. `.cargo/config.toml`, source replacement settings and other Cargo configuration are not interpreted.

No Cargo or Rust installation is required. The extension never runs Cargo commands, downloads `.crate` archives, searches the local Cargo source cache, or reads license files. It does not resolve dependency graphs, evaluate features/targets, list transitive dependencies, check MSRV compatibility or audit licenses. A missing license string means metadata is unavailable, not that use is prohibited. Existing `unknownText` and formatting settings apply; intentionally skipped dependencies remain hidden. **The displayed version is a metadata lookup target, not a guarantee of the version used by an actual build under every Cargo configuration.**

Editing/saving the document, switching editors or Refresh triggers updates. Auxiliary file reads are cached for five seconds and annotation results for one minute; expiration alone does not trigger an update. After an external change to Cargo.lock or a workspace manifest, use Refresh for immediate re-evaluation, or wait for these caches to expire and trigger another editor update. Clear Cache also invalidates auxiliary reads. Cargo setting changes invalidate annotations.

Opening a workspace containing `Cargo.toml` activates the extension even if TOML files are treated as plain text. Opening a standalone file without such a workspace requires a TOML language registration (or running the Refresh command). The extension contributes no TOML grammar or language server. VS Code 1.90 remains the minimum supported version.

## Go

```go
require (
	github.com/gorilla/mux v1.8.1                  // BSD-3-Clause
	github.com/docker/docker v24.0.7+incompatible  // Apache-2.0 AND MIT
	example.com/forked v1.0.0                      // MIT (as github.com/BurntSushi/toml v1.3.2)
	example.com/local v0.1.0                       // (nothing: a local directory)
)

replace example.com/forked => github.com/BurntSushi/toml v1.3.2
replace example.com/local => ../local
```

Comments above illustrate annotations, not changes the extension writes to files. Every `require` is read, in single-line and block form, whether or not it is marked `// indirect`. The version is taken exactly as written: the go command resolves with minimal version selection, and since Go 1.17 `go mod tidy` records every module the build needs in the main module's `go.mod` at the version it selected. Pseudo-versions and `+incompatible` versions are looked up like any other.

`replace` directives in the same `go.mod` are applied first. A replacement of one exact version beats a replacement of every version, as in the go command. A module target is looked up as that module at its version, and the hover says so; a directory target (`./x`, `../x`, an absolute or Windows path) is skipped. `exclude`, `retract`, `tool` and `go.work` (including its own `replace` directives) are not interpreted.

Licenses come from [deps.dev](https://deps.dev), one `GetVersion` request per module version. The Go module mirror carries no license metadata and pkg.go.dev has no API for it; deps.dev scans the modules the mirror serves. When it finds more than one license file in a module, the annotation joins them with `AND`, because each applies to part of the module. A license it found but could not identify (`non-standard`) shows as unknown. A found answer is cached; a miss is not, because a release published moments ago may not have been ingested yet. The hover title links to `https://pkg.go.dev/<module>@<version>`, and the homepage to the source repository deps.dev records. deps.dev does not carry the version's `go` directive, so that one item is read from the version's own `go.mod` on the module proxy and shown after the license as the minimum it declares; the read is best-effort — a failure leaves the license result exactly as it was.

A module matching `GOPRIVATE`, `GONOPROXY` or `GONOSUMDB` is skipped without any request, so its path is never sent to deps.dev. Those variables are read the way the go command reads them: the process environment first, then the go env file `go env -w` writes (`$GOENV`, or `go/env` under the user config directory). Patterns are matched against leading path elements, as `module.MatchPrefixPatterns` does. A module path whose first element has no dot (a local-only or standard-library path) is reported as unknown.

No Go installation is required. The extension never runs `go`, reads the module cache or `go.sum`, or opens license files. A `go.mod` extracted into the module cache (`…/<module>@<version>/go.mod`) is not annotated. Setting `go.useRegistry` to `false` stops requests while still using cached answers.

## Ruby

```ruby
# Gemfile
source "https://rubygems.org"

gem "rails", "~> 8.0" # MIT
gem "rake", "13.2.1" # MIT
gem "vendored", path: "../vendored" # (nothing: a local path)
```

Comments above illustrate annotations, not changes the extension writes to files. A Gemfile is executable Ruby, but a dependency declaration is a single `gem` call, and only those calls are read — the file is tokenized, never executed. In a `.gemspec`, the `add_dependency` / `add_runtime_dependency` / `add_development_dependency` calls are read the same way. A name or requirement computed by an expression (interpolation, a variable) is reported as unknown rather than guessed, and a half-typed line never blanks out the declarations around it.

The lookup path is:

1. Look in the `Gemfile.lock` beside the manifest for a unique version matching the name and the declared requirement, in a `GEM` section served by a public source (rubygems.org, or gem.coop, which mirrors the same package set).
2. If one is found, use that version's metadata from the cached or fetched version list.
3. Otherwise choose the highest public version satisfying the RubyGems requirement — including the pessimistic `~>` operator and the rule that a prerelease only counts when the requirement itself names one.

Licenses come from rubygems.org's versions API (`GET /api/v1/versions/<name>.json`), which reports every published version and the licenses it declares in one request; the list is cached and shared across manifests. A release published for several platforms appears once per platform with the same licenses, and collapses to one record. The same response carries each release's `required_ruby_version`, shown after the license the way npm shows `engines.node`; an unconstrained release reports `>= 0` there and shows nothing. When a release declares several licenses, the annotation joins them with `AND`, as the gemspec list names every license the release is distributed under. A release that declares none shows as unknown. The hover title links to `https://rubygems.org/gems/<name>/versions/<version>`, and the `via` description distinguishes `Gemfile.lock + RubyGems` from `manifest requirement + RubyGems`. **Gemfile.lock does not contain licenses** — it only pins the version.

`git:`, `github:` and `path:` gems, and gems declared under a `source` block (or a per-gem `source:`) pointing anywhere other than rubygems.org, are skipped: their names are never sent to rubygems.org. A `GEM` section of Gemfile.lock served by a private server is likewise ignored, since its names may collide with public ones. `gemspec` directives in a Gemfile, `eval_gemfile`, `ruby` version directives and other Bundler DSL calls are not interpreted.

No Ruby or Bundler installation is required. The extension never runs `ruby` or `bundle`, reads installed gems, or opens license files. It does not resolve dependency graphs or list transitive dependencies — Gemfile.lock entries are only used to pin a declared gem's version, never annotated themselves. Setting `rubygems.useRegistry` to `false` stops requests while still using cached answers, and `rubygems.useLockfiles` to `false` ignores Gemfile.lock.

## Composer

```jsonc
// composer.json
{
  "require": {
    "php": ">=8.1", // (nothing: a platform package)
    "psr/log": "^3.0", // MIT
    "acme/internal": "dev-main" // MIT (from composer.lock; no Packagist link for a path repository)
  },
  "require-dev": {
    "phpunit/phpunit": "^11.0" // BSD-3-Clause
  }
}
```

Comments above illustrate annotations, not changes the extension writes to files. The `require` and `require-dev` sections are read from the JSON syntax tree, so a half-typed manifest still yields whatever can be read. Names are lowercased, as `composer.lock`, `installed.json` and Packagist all key packages that way. Platform packages — `php`, `php-64bit`, `hhvm`, `ext-*`, `lib-*`, `composer-plugin-api`, `composer-runtime-api` — are not annotated: they constrain PHP itself, not a package with a license.

The lookup path is:

1. Look in `<vendor-dir>/composer/installed.json` beside the manifest (`config.vendor-dir` is honored; the default is `vendor`). Composer writes every installed package's full record there, license included, so one read answers every dependency. Parent directories are not searched: Composer never hoists, and a monorepo root's `vendor/` would report the wrong version for a nested manifest.
2. Otherwise look in `composer.lock`, whose `packages` and `packages-dev` records also carry the license.
3. Otherwise ask Packagist (`https://repo.packagist.org/p2/<vendor>/<name>.json`) and choose the highest version satisfying the constraint under Composer's stability rules: `minimum-stability` (default `stable`) is replaced for that package by an explicit `@flag`, lowered by a prerelease named in the constraint, and `prefer-stable` prefers a stable candidate over a higher unstable one.

A vendored or locked version is used only if it still satisfies the constraint written in `composer.json`; a stale lock falls through to step 3 instead of reporting a version the manifest no longer asks for. A `dev-*` branch satisfies a numeric constraint through its aliases — the constraint's own `as` clause, the package's `extra.branch-alias`, or the lock's `aliases` — the way Composer itself lets `^1.0` be met by `dev-main`. Branch requirements resolve from steps 1 and 2 only; Packagist's separate `~dev` metadata is not fetched.

Version constraints are interpreted exactly as `composer/semver` does, independently of npm ranges: `~1.2` means `>=1.2 <2.0`, `^0.3` means `>=0.3 <0.4`, `1.2.*`, hyphen ranges, `||`/`|` OR, space/comma AND, `@stability` flags, `as` aliases and `#ref` suffixes are all understood. Composer's `license` field is a string or an array; the array is disjunctive by Composer's definition ("pick one"), so several entries are joined with `OR`. A package declaring no license shows as unknown. Each package's own `require.php` constraint is shown after the license the way npm shows `engines.node`.

The hover title links to `https://packagist.org/packages/<vendor>/<name>#<version>` only for a package known to come from Packagist — a p2 answer, or a lock/installed record whose `notification-url` is Packagist's. A package from a `path`, `vcs` or private repository keeps its license but gets no link. Packagist's p2 files are static CDN JSON; they are fetched in parallel under `maxConcurrentRequests`, the expanded version list is cached, a miss is not, and an HTTP 429 pauses every request for a minute without retrying. Private repositories (Private Packagist, Satis, `vcs`/`path` repositories) are never contacted; a manifest whose `repositories` sets `"packagist.org": false` sends nothing to Packagist at all.

No PHP or Composer installation is required. The extension never runs `composer`, reads `~/.composer`, or opens license files, and it does not resolve dependency graphs. Setting `composer.useRegistry` to `false` stops requests while still using `vendor/`, `composer.lock` and cached answers, and `composer.useLockfiles` to `false` ignores `composer.lock`.
