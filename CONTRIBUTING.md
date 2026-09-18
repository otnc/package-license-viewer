# Contributing

**English** | [日本語](CONTRIBUTING.ja.md)

Thanks for looking at this. This file covers the architecture, adding a new ecosystem, running the project locally, and releasing. For what the extension actually does, see [README.md](README.md).

## Language

Code comments and documentation (README, this file, etc.) are in English, so the project stays approachable to anyone reading the source.

Commit messages, issues and pull requests may be written in either English or Japanese, whichever you're more comfortable with — don't let the language be a reason not to contribute.

Whichever language you write the rest of the subject in, keep the [Conventional Commits](https://www.conventionalcommits.org/) type prefix (`feat:`, `fix:`, `docs:`, `chore:`, …) in English — `CHANGELOG.md` is generated straight from it (see Changelog below), and the generator only recognizes the English type names.

## Architecture

Everything hangs off one interface, [`LicenseProvider`](packages/core/src/providers/types.ts). A provider turns a manifest into a list of dependencies (`parse`) and resolves each one to a license (`resolve`). Providers are registered in [`packages/core/src/providers/index.ts`](packages/core/src/providers/index.ts); nothing else needs to change to add one.

Everything a provider doesn't have to worry about is shared:

- [`packages/vscode-extension/src/annotator.ts`](packages/vscode-extension/src/annotator.ts) — debouncing, cancellation, concurrency limits, flicker-free redrawing, decoration and hover rendering
- [`packages/core/src/cache.ts`](packages/core/src/cache.ts) — the two-level (in-memory + on-disk) cache with a TTL
- [`packages/core/src/net.ts`](packages/core/src/net.ts) — fetch with a timeout and cancellation, and a small concurrency limiter

The npm provider ([`packages/core/src/providers/npm/`](packages/core/src/providers/npm/)) resolves in three steps — `node_modules`, then the lockfile, then the registry — each in its own file ([`installed.ts`](packages/core/src/providers/npm/installed.ts), [`lockfile/`](packages/core/src/providers/npm/lockfile/), [`registry.ts`](packages/core/src/providers/npm/registry.ts)). The JSR provider ([`packages/core/src/providers/jsr/`](packages/core/src/providers/jsr/)) reuses the npm registry client for `npm:` specifiers and routes `@jsr/scope__name` npm-compatibility names back to JSR.

For exactly how each ecosystem resolves a license (npm/JSR precedence, package-manager layouts, Cargo's lookup path), see [docs/resolution-details.md](docs/resolution-details.md).

### Cargo implementation

Cargo's implementation lives in [`packages/core/src/providers/crates/`](packages/core/src/providers/crates/). `parse.ts` uses the position-aware MIT-licensed `toml-eslint-parser` 0.10.0 (CommonJS, Node >=16 supported); keep the extension's minimum VS Code version when changing this dependency. TOML 1.0 declarations use their first line, or the dependency table header, as the annotation position. Invalid TOML yields no entries. Cargo requirements are interpreted independently of npm ranges; the saved Rust `semver::VersionReq` oracle and generated Cargo.lock fixture are described in [`cargo-provenance.md`](test/fixtures/lockfiles/cargo-provenance.md).

`workspace.ts` and `lockfile.ts` only locate declarations and uniquely matching public versions. `client.ts` shares a send-start limiter (one request per second) across clients and uses `fetchJson` for HTTP. Its `/versions` request deliberately omits `per_page`: the [API implementation](https://github.com/rust-lang/crates.io/blob/main/src/controllers/krate/versions.rs) returns all versions in this mode. A response advertising another page is rejected instead of being treated as complete. The version records carry `license`, so candidate selection needs no request for each individual version. Exact locked versions use the per-version endpoint, including yanked versions. Transient failures are never written to `LicenseCache`; HTTP 429 delays subsequent sends for at least one minute without automatic retries.

Keep manifest resolution keys separate from public version metadata keys. The former include the URI, alias, section, source, requirement and workspace context; the latter share exact public metadata across documents. `invalidate()` clears auxiliary reads and cancels pending Cargo requests. No Cargo command, archive reader, source cache, filesystem watcher or dependency graph belongs here.

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

Register it in [`packages/core/src/providers/index.ts`](packages/core/src/providers/index.ts) and add the language to `activationEvents` in [`packages/vscode-extension/package.json`](packages/vscode-extension/package.json).

Also add a row to the language/package-manager table in [README.md](README.md#supported-languages) (edit [`i18n/README.base.md`](i18n/README.base.md), not `README.md` — see "Documentation and i18n" below), and remove the corresponding "planned" row if there's a tracking issue for it.

### Link the hover title to the package's registry page

Every provider is expected to make the hover title clickable, the same way npm and JSR do — don't ship one that leaves it as plain text. Set one of these two `LicenseInfo` fields from `resolve()`, whichever fits the registry's URL shape:

- `registryPackageName` — when the target really is `https://www.npmjs.com/package/<name>/v/<version>` (npm and npm-compatible aliases only; nothing else should set this).
- `packagePageUrl` — the exact URL for anything else, e.g. `https://crates.io/crates/<name>/<version>` or `https://pypi.org/project/<name>/<version>/`. This is what JSR uses.

`buildHover` in [`packages/core/src/format.ts`](packages/core/src/format.ts) picks whichever is set (`registryPackageName` wins if somehow both are) and wraps it around the `` `name@version` `` title automatically — do not build that link yourself. Two things matter when you set it:

- **Resolve aliases first.** The link must point at the actual registry package, not the local manifest key — see how the npm provider follows an `npm:` alias to its real target before setting `registryPackageName` (`packages/core/src/providers/npm/index.ts`).
- **Never link something that isn't really on that registry.** A `file:`/`git`/local-path dependency, or one you're not confident about, should leave both fields unset rather than link to a URL that might 404.

If the registry also exposes a genuine, separately-declared homepage, put that in `homepage` as usual — `buildHover` already drops the `Homepage` line when it would just repeat the title link (as it does for JSR, which has no separate homepage of its own).

Python, Ruby, Go and MoonBit support are planned but not implemented yet — see the open issues linked from [README.md](README.md#supported-languages) for current status. These metadata endpoints may be useful:

- PyPI: `https://pypi.org/pypi/<name>/<version>/json` → `info.license` / `info.classifiers`
- Go: `https://pkg.go.dev/<module>?tab=licenses` (no JSON API; needs the module proxy or scraping)

## Documentation and i18n

`README.md`, `README.ja.md`, `CONTRIBUTING.md` and `CONTRIBUTING.ja.md` are generated by [Kiritan](https://github.com/otnc/kiritan) from the base sources in [`i18n/`](i18n/) — never hand-edit a generated file, it gets silently overwritten by the next build. Edit `i18n/README.base.md` or `i18n/CONTRIBUTING.base.md` instead, then run:

```sh
npm run docs:build   # regenerate every localized document
npm run docs:check   # verify nothing is left missing/stale
```

See [AGENTS.md](AGENTS.md) and the Kiritan skill installed at [`.agents/skills/kiritan`](.agents/skills/kiritan/SKILL.md) for the full directive syntax and CLI reference.

## Agent skills

AI coding agents get extra instructions ("skills") from [`.agents/skills/`](.agents/skills/) via the [`skills` CLI](https://www.npmjs.com/package/skills) (`npx skills`). Only `.agents/skills/` and [`skills-lock.json`](skills-lock.json) are committed — that's the canonical copy. Every other location a given agent might look in (`.claude/skills/`, `agent/skills/`, …) is a generated symlink or copy and is gitignored; recreate them after cloning with:

```sh
npx skills experimental_install
```

To add a new skill:

```sh
npx skills add <owner>/<repo> --agent '*' -y
```

This clones the source, copies the canonical file into `.agents/skills/<name>/`, symlinks or copies it into whichever agent directories exist locally, and records the source and its hash in `skills-lock.json`. Only commit the `.agents/skills/` and `skills-lock.json` changes — leave the other generated agent directories untracked (see [`.gitignore`](.gitignore)).

## Development

```sh
npm install
npm run watch:vscode # esbuild in watch mode
# press F5 in VS Code to launch the Extension Development Host
```

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

Compile before unit tests to exercise the bundle rather than skip that check. Cargo's integration suite launches a separate Cargo-only workspace with TOML associated to plaintext. It checks automatic activation before opening a document or calling any extension command, then tests URI-based workspace/lockfile reads, cached metadata, Hover links, unsaved parsing and settings. Registry access is disabled in this fixture. To exercise the minimum host, set `PLV_VSCODE_VERSION=1.90.0` when running `npm run test:integration`; otherwise the current stable host is used.

Run `npm run format` before committing; CI enforces `format:check` and `lint`.

## Testing

Test code is split across two tiers — different tools on purpose, not an inconsistency:

- **Unit tests** ([`test/unit/*.test.js`](test/unit/)) run with plain Node's built-in `node:test`, against a hand-written `vscode` stub ([`test/unit/vscode-stub.js`](test/unit/vscode-stub.js)) and the compiled `out/` output of `packages/core` and `packages/vscode-extension` (`npm run build-tests`) — no `tsc`-for-tests step beyond that, no real VS Code, no mocha. They live at the repository root, outside either package, because they exercise both together (e.g. `crates.test.js` drives `packages/core`'s `CratesLicenseProvider` through `packages/vscode-extension`'s `Annotator`). Staying plain JavaScript is deliberate: it's what lets `npm test` run fast and exercise the actually-compiled output, catching the kind of bundling bug a TypeScript-only test run would miss (see "`npm test` also loads the bundled `dist/extension.js`" above).
- **Integration tests** ([`packages/vscode-extension/test/integration/*.test.ts`](packages/vscode-extension/test/integration/)) run inside a real VS Code via `@vscode/test-cli`. They're TypeScript because they use the real `vscode` module and its types directly, and they live inside `packages/vscode-extension` because that's genuinely what they exercise, compiled by that package's own `tsc` pass rather than a separate one.

[`test/fixtures/`](test/fixtures/) stays at the repository root, outside both packages, because it's shared data — real lockfiles and sample workspaces produced by actually running npm/pnpm/yarn/bun — not test code, and both tiers read from it.

When adding a provider or changing resolution logic, add a unit test next to the existing ones in `test/unit/`, following whichever of [`index.test.js`](test/unit/index.test.js) (npm/JSR) or [`crates.test.js`](test/unit/crates.test.js) (Cargo) matches your ecosystem's shape. Reach for an integration test only when the behavior genuinely needs a real VS Code host (activation, `vscode.workspace.fs`, real settings) — both suites build on the fixtures under [`test/fixtures/workspace/`](test/fixtures/workspace/) and [`test/fixtures/cargo-workspace/`](test/fixtures/cargo-workspace/).

## Releasing

[`.github/workflows/release.yml`](.github/workflows/release.yml) is run by hand from the Actions tab. Give it a version — a bump keyword (`patch`, `minor`, `major`, `prerelease`) or an explicit version like `0.2.0` — and it does the rest:

1. type-check, unit tests, and the integration suite in a real VS Code
2. bump `package.json`, and update `CHANGELOG.md` from Conventional Commits since the last tag
3. regenerate `README.md`/`README.ja.md`/`CONTRIBUTING.md`/`CONTRIBUTING.ja.md` from `i18n/*.base.md` (`npm run docs:build`), so a release never ships with generated docs that drifted out of sync
4. build the `.vsix`
5. publish to the VS Code Marketplace
6. commit (including any documentation rebuilt in step 3), tag and push, then create the GitHub Release with the `.vsix` attached

Publishing is skipped automatically when `VSCE_PAT` is absent, so the workflow is usable before you have a token. Get one from <https://marketplace.visualstudio.com/manage> — an Azure DevOps PAT with the Marketplace → Manage scope — and add it as a repository secret.

### Changelog

`CHANGELOG.md` is generated with [git-cliff](https://git-cliff.org) (config in [`cliff.toml`](cliff.toml)) from commit messages since the last tag, grouped by [Conventional Commits](https://www.conventionalcommits.org/) type — `feat` → Added, `fix` → Fixed, `perf` → Performance, `refactor`/`revert` → Changed. Everything else (`chore`, `docs`, `test`, `style`, `ci`, `build`, `release`, merge commits) is left out, the same way it always was when this was written by hand. Write commit subjects with that in mind — they end up as changelog lines close to verbatim.

To preview what the next release's entry would look like without touching anything:

```sh
npx git-cliff --unreleased --tag vX.Y.Z
```

Tagging happens only after publishing succeeded, so a failed release leaves no dangling tag. Tick `dry_run` to rehearse the whole pipeline without publishing, committing or tagging.

To publish locally instead, copy `.env.example` to `.env`, fill in `VSCE_PAT`, and run `npm run publish` (optionally `npm run publish -- patch`).
