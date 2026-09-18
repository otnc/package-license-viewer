# Contributing

Thanks for looking at this. This file covers the architecture, adding a new ecosystem, running the project locally, and releasing. For what the extension actually does, see [README.md](README.md).

## Language

Code comments and documentation (README, this file, etc.) are in English, so the project stays approachable to anyone reading the source.

Commit messages, issues and pull requests may be written in either English or Japanese, whichever you're more comfortable with — don't let the language be a reason not to contribute.

## Architecture

Everything hangs off one interface, [`LicenseProvider`](src/providers/types.ts). A provider turns a manifest into a list of dependencies (`parse`) and resolves each one to a license (`resolve`). Providers are registered in [`src/providers/index.ts`](src/providers/index.ts); nothing else needs to change to add one.

Everything a provider doesn't have to worry about is shared:

- [`src/annotator.ts`](src/annotator.ts) — debouncing, cancellation, concurrency limits, flicker-free redrawing, decoration and hover rendering
- [`src/cache.ts`](src/cache.ts) — the two-level (in-memory + on-disk) cache with a TTL
- [`src/net.ts`](src/net.ts) — fetch with a timeout and cancellation, and a small concurrency limiter

The npm provider ([`src/providers/npm/`](src/providers/npm/)) resolves in three steps — `node_modules`, then the lockfile, then the registry — each in its own file ([`installed.ts`](src/providers/npm/installed.ts), [`lockfile/`](src/providers/npm/lockfile/), [`registry.ts`](src/providers/npm/registry.ts)). The JSR provider ([`src/providers/jsr/`](src/providers/jsr/)) reuses the npm registry client for `npm:` specifiers and routes `@jsr/scope__name` npm-compatibility names back to JSR.

### Cargo implementation

Cargo's implementation lives in [`src/providers/crates/`](src/providers/crates/). `parse.ts` uses the position-aware MIT-licensed `toml-eslint-parser` 0.10.0 (CommonJS, Node >=16 supported); keep the extension's minimum VS Code version when changing this dependency. TOML 1.0 declarations use their first line, or the dependency table header, as the annotation position. Invalid TOML yields no entries. Cargo requirements are interpreted independently of npm ranges; the saved Rust `semver::VersionReq` oracle and generated Cargo.lock fixture are described in [`cargo-provenance.md`](test/fixtures/lockfiles/cargo-provenance.md).

`workspace.ts` and `lockfile.ts` only locate declarations and uniquely matching public versions. `client.ts` shares a send-start limiter (one request per second) across clients and uses `fetchJson` for HTTP. Its `/versions` request deliberately omits `per_page`: the [API implementation](https://github.com/rust-lang/crates.io/blob/main/src/controllers/krate/versions.rs) returns all versions in this mode. A response advertising another page is rejected instead of being treated as complete. The version records carry `license`, so candidate selection needs no request for each individual version. Exact locked versions use the per-version endpoint, including yanked versions. Transient failures are never written to `LicenseCache`; HTTP 429 delays subsequent sends for at least one minute without automatic retries.

Keep manifest resolution keys separate from public version metadata keys. The former include the URI, alias, section, source, requirement and workspace context; the latter share exact public metadata across documents. `invalidate()` clears auxiliary reads and cancels pending Cargo requests. No Cargo command, archive reader, source cache, filesystem watcher or dependency graph belongs here.

### MoonBit implementation

MoonBit's implementation lives in [`src/providers/moonbit/`](src/providers/moonbit/). moon is replacing `moon.mod.json` with `moon.mod`, a small DSL, so both are parsed: [`dsl.ts`](src/providers/moonbit/dsl.ts) is a tokenizer for the [published grammar](https://docs.moonbitlang.com/en/latest/toolchain/moon/module.html) that reads only what is needed (the strings in a top-level `import` block, a `key = "string"`, a `key = [ … ]`) and skips whatever it does not recognize, so a half-typed statement never blanks out the dependencies above it. [`parse.ts`](src/providers/moonbit/parse.ts) lowers both formats to the same entries, splitting each `import` item on its **last** `@` the way `read_module_from_dsl` does in moon.

A declared version is an exact `semver::Version`, never a range: moon resolves with [minimal version selection](https://github.com/moonbitlang/moon/blob/main/crates/mooncake/src/resolver/mvs.rs). Nothing here interprets ranges, and nothing runs `moon`. Resolution is [`.mooncakes`](src/providers/moonbit/installed.ts) → `moon.work` members → the [registry index](src/providers/moonbit/registryIndex.ts) → [mooncakes.io](src/providers/moonbit/client.ts); the first two answer from the manifest that `moon build` unpacked, which is the only source that knows where selection actually landed.

The registry index is the clone `moon update` maintains in `$MOON_HOME/registry/index` (`~/.moon` by default), one JSON-lines file per module carrying every version **and its license** — which is why an installed toolchain resolves offline. Keep dropping a malformed line on its own rather than the whole file, as the crates.io client does for a bad version record.

mooncakes.io answers `/api/v0/modules/<user>/<module>@<version>` with that release's metadata and `…/<user>/<module>` with the newest one; only the exact-version answer is cached, since the newest release is by definition what changes. That route has **no form for a nested name** such as `moonbitlang/lex/runtime`, even though the index carries one — those resolve from disk only and must not be given a hover link that would fail to load. The registry publishes no rate limit, so sends are spaced out instead of filling `maxConcurrentRequests`, and an HTTP 429 stands down for a minute without retrying.

No `moon` invocation, archive download, `.mbt` parsing, package-level (`moon.pkg`) handling or dependency graph belongs here.

## Adding another ecosystem

Implement `LicenseProvider`, register it, and connect its activation and settings.

```ts
export class ExampleLicenseProvider implements LicenseProvider {
  readonly id = "example";
  supports(document) { /* recognize the manifest */ }
  isEnabled() { return getSetting("example.enabled", true); }
  parse(document) { /* → DependencyEntry[] (name, spec, section, line) */ }
  cacheKey(entry) { /* include document/source context when resolution depends on it */ }
  async resolve(entry, document, token) { /* → LicenseInfo */ }
}
```

Register it in [`src/providers/index.ts`](src/providers/index.ts) and add the language to `activationEvents` in `package.json`.

### Link the hover title to the package's registry page

Every provider is expected to make the hover title clickable, the same way npm and JSR do — don't ship one that leaves it as plain text. Set one of these two `LicenseInfo` fields from `resolve()`, whichever fits the registry's URL shape:

- `registryPackageName` — when the target really is `https://www.npmjs.com/package/<name>/v/<version>` (npm and npm-compatible aliases only; nothing else should set this).
- `packagePageUrl` — the exact URL for anything else, e.g. `https://crates.io/crates/<name>/<version>` or `https://pypi.org/project/<name>/<version>/`. This is what JSR uses.

`buildHover` in [`src/format.ts`](src/format.ts) picks whichever is set (`registryPackageName` wins if somehow both are) and wraps it around the `` `name@version` `` title automatically — do not build that link yourself. Two things matter when you set it:

- **Resolve aliases first.** The link must point at the actual registry package, not the local manifest key — see how the npm provider follows an `npm:` alias to its real target before setting `registryPackageName` (`src/providers/npm/index.ts`).
- **Never link something that isn't really on that registry.** A `file:`/`git`/local-path dependency, or one you're not confident about, should leave both fields unset rather than link to a URL that might 404.

If the registry also exposes a genuine, separately-declared homepage, put that in `homepage` as usual — `buildHover` already drops the `Homepage` line when it would just repeat the title link (as it does for JSR, which has no separate homepage of its own).

Python and Go support are planned but not implemented yet — see [README.md](README.md#other-languages) for the current status. These metadata endpoints may be useful:

- PyPI: `https://pypi.org/pypi/<name>/<version>/json` → `info.license` / `info.classifiers`
- Go: `https://pkg.go.dev/<module>?tab=licenses` (no JSON API; needs the module proxy or scraping)

## Development

```sh
npm install
npm run watch      # esbuild in watch mode
# press F5 in VS Code to launch the Extension Development Host
```

Two launch configurations are contributed. **Run Extension** opens an empty Extension Development Host; **Run Extension (MoonBit sample)** opens [`test/fixtures/moonbit-workspace/`](test/fixtures/moonbit-workspace/) in it, which is a two-member `moon.work` holding one manifest of each format plus an unpacked `.mooncakes` module, so the annotations are visible the moment the host finishes loading. Either way, `File > Open Folder` in the host switches to a real project.

```sh
npm run format:check     # prettier --check .
npm run lint             # eslint .
npm run check-types      # tsc --noEmit
npm test                 # unit tests, against real lockfile fixtures
npm run test:integration # runs the extension inside a real VS Code
npm run package           # build a .vsix
```

The lockfiles in [`test/fixtures/lockfiles/`](test/fixtures/lockfiles/) were produced by really running `npm`, `pnpm`, `yarn` (classic and berry) and `bun` against the same manifest, so the parsers are tested against the real thing rather than hand-written samples.

`npm test` also loads the bundled `dist/extension.js`, because bundling can break the extension on its own: a dependency whose entry point defers its `require()` calls to runtime resolves fine under `tsc` and then fails inside the extension host.

Compile before unit tests to exercise the bundle rather than skip that check. Cargo and MoonBit each get their own integration workspace, with `Cargo.toml` and `moon.mod` associated to plaintext so that dispatch cannot quietly come to depend on a language registration. It checks automatic activation before opening a document or calling any extension command, then tests URI-based workspace/lockfile reads, cached metadata, Hover links, unsaved parsing and settings. Registry access is disabled in this fixture. To exercise the minimum host, set `PLV_VSCODE_VERSION=1.90.0` when running `npm run test:integration`; otherwise the current stable host is used.

Run `npm run format` before committing; CI enforces `format:check` and `lint`.

## Releasing

[`.github/workflows/release.yml`](.github/workflows/release.yml) is run by hand from the Actions tab. Give it a version — a bump keyword (`patch`, `minor`, `major`, `prerelease`) or an explicit version like `0.2.0` — and it does the rest:

1. type-check, unit tests, and the integration suite in a real VS Code
2. bump `package.json`, and update `CHANGELOG.md` from Conventional Commits since the last tag
3. build the `.vsix`
4. publish to the VS Code Marketplace
5. commit, tag and push, then create the GitHub Release with the `.vsix` attached

Publishing is skipped automatically when `VSCE_PAT` is absent, so the workflow is usable before you have a token. Get one from <https://marketplace.visualstudio.com/manage> — an Azure DevOps PAT with the Marketplace → Manage scope — and add it as a repository secret.

### Changelog

`CHANGELOG.md` is generated with [git-cliff](https://git-cliff.org) (config in [`cliff.toml`](cliff.toml)) from commit messages since the last tag, grouped by [Conventional Commits](https://www.conventionalcommits.org/) type — `feat` → Added, `fix` → Fixed, `perf` → Performance, `refactor`/`revert` → Changed. Everything else (`chore`, `docs`, `test`, `style`, `ci`, `build`, `release`, merge commits) is left out, the same way it always was when this was written by hand. Write commit subjects with that in mind — they end up as changelog lines close to verbatim.

To preview what the next release's entry would look like without touching anything:

```sh
npx git-cliff --unreleased --tag vX.Y.Z
```

Tagging happens only after publishing succeeded, so a failed release leaves no dangling tag. Tick `dry_run` to rehearse the whole pipeline without publishing, committing or tagging.

To publish locally instead, copy `.env.example` to `.env`, fill in `VSCE_PAT`, and run `npm run publish` (optionally `npm run publish -- patch`).
