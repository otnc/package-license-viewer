# Package License Viewer

**English** | [日本語](README.ja.md)

[![VS Code Marketplace Version](https://vsmarketplacebadges.dev/version/otoneko1102.package-license-viewer.svg)](https://marketplace.visualstudio.com/items?itemName=otoneko1102.package-license-viewer)
[![VS Code Marketplace Installs](https://vsmarketplacebadges.dev/installs-short/otoneko1102.package-license-viewer.svg)](https://marketplace.visualstudio.com/items?itemName=otoneko1102.package-license-viewer)
[![Vim/NeoVim](https://img.shields.io/badge/Vim%2FNeoVim-experimental-yellow)](doc/package_license_viewer.txt)
[![CI](https://github.com/otnc/package-license-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/otnc/package-license-viewer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/otnc/package-license-viewer)](LICENSE)

Shows each dependency's license at the end of its line in the manifest. The license is colored, so you can spot it at a glance.

```jsonc
// package.json
{
  "dependencies": {
    "lodash": "^4.17.21",        // MIT
    "@babel/core": "^7.0.0",     // MIT
    "left-pad": "1.3.0",         // WTFPL
    "axios": "^1.1.1"            // MIT (Node: >=20)
  },
  "devDependencies": {
    "typescript": "^5.7.2"       // Apache-2.0
  }
}
```

Hover an annotation to see the resolved version, where the information came from, and links to the package's homepage and source repository.

## Supported languages

| Language | Support | Version | Package managers | Main contributors | Notes |
| --- | --- | --- | --- | --- | --- |
| JavaScript / TypeScript | ✅ | ✅ | npm, pnpm, yarn (classic & berry), bun | [@otnc](https://github.com/otnc) | `package.json`, plus `deno.json`/`jsr.json`/`import_map.json` and pnpm workspace catalogs |
| Deno / JSR | ✅ | ✅ | jsr, `npm:` specifiers | [@otnc](https://github.com/otnc) | Same manifests as above; both `jsr:` and `npm:` specifiers are resolved |
| Go | ✅ | ✅ | go mod | [@otnc](https://github.com/otnc) | `go.mod` requirements, with `replace` applied, resolved against deps.dev; no local Go install needed, and modules matching `GOPRIVATE` are never looked up |
| Rust | ✅ | ✅ | Cargo | [@bem130](https://github.com/bem130) | `Cargo.toml` declarations resolved against crates.io / `Cargo.lock`; no local Cargo install needed |
| MoonBit | ✅ | ❌ | moon | [@Allianaab2m](https://github.com/Allianaab2m) | `moon.mod` / `moon.mod.json` resolved against `.mooncakes`, the local registry index and mooncakes.io; no local `moon` install needed |
| Ruby | ✅ | ✅ | bundler, gem | [@muse-chan](https://github.com/muse-chan) | `Gemfile` and `*.gemspec` declarations resolved against rubygems.org / `Gemfile.lock`; no local Ruby install needed |
| PHP | ✅ | ✅ | Composer | [@v420v](https://github.com/v420v) | `composer.json` requirements resolved against `vendor/` / `composer.lock` / Packagist; no local PHP or Composer install needed |
| Python | ❌ | ❌ | pip, uv, poetry |  | Planned ([Issue #14](https://github.com/otnc/package-license-viewer/issues/14)) |
| Your language? |  |  |  |  | Not listed? Support for more languages is welcome. Open an [issue](https://github.com/otnc/package-license-viewer/issues) or a pull request (see [CONTRIBUTING.md](CONTRIBUTING.md#adding-another-ecosystem)). |

See [docs/resolution-details.md](docs/resolution-details.md) for how each language resolves a license, notes for each package manager, and known cases where the registry has no license data (such as JSR).

## Editors

| Editor | Support | Notes |
| --- | --- | --- |
| VS Code | ✅ | The full feature set: inline annotations, hover, and every `packageLicenseViewer.*` setting. |
| Neovim | ✅ (experimental) | Inline annotations, hover and settings, through a bundled Node language server and a Lua layer (`vim.lsp.start()`, `nvim_buf_set_extmark()`). The plugin builds the server with npm on first use. See `:help package_license_viewer`. |
| Vim | ✅ (experimental) | Same features as Neovim, through the plugin's own VimScript LSP client (`job`/`channel` + `prop_add`/`popup_atcursor`). Needs Vim 9.0+ with `+job`, `+channel` and `+textprop`. See `:help package_license_viewer`. |

The Vim/Neovim plugin is at the repository root, so every plugin manager can install it from `otnc/package-license-viewer` alone. No `rtp` option or build hook is needed.

| Plugin manager | Editor | Install |
| --- | --- | --- |
| [lazy.nvim](https://github.com/folke/lazy.nvim) | Neovim | `{ "otnc/package-license-viewer" }` |
| vim.pack | Neovim 0.12+ | `vim.pack.add({ "https://github.com/otnc/package-license-viewer" })` |
| [mini.deps](https://github.com/echasnovski/mini.deps) | Neovim | `MiniDeps.add("otnc/package-license-viewer")` |
| [packer.nvim](https://github.com/wbthomason/packer.nvim) | Neovim | `use("otnc/package-license-viewer")` |
| [paq-nvim](https://github.com/savq/paq-nvim) | Neovim | `"otnc/package-license-viewer",` |
| [vim-plug](https://github.com/junegunn/vim-plug) | Vim / Neovim | `Plug 'otnc/package-license-viewer'` |
| [dein.vim](https://github.com/Shougo/dein.vim) | Vim / Neovim | `call dein#add('otnc/package-license-viewer')` |
| [vim-jetpack](https://github.com/tani/vim-jetpack) | Vim / Neovim | `Jetpack 'otnc/package-license-viewer'` |
| Native packages (`:help packages`) | Vim / Neovim | `git clone` into `~/.vim/pack/plugins/start/` |

Node.js 22 or later and npm must be on `$PATH`. The plugin builds the language server in the background the first time you open a supported file, and again after the plugin is updated. See [`:help package_license_viewer`](doc/package_license_viewer.txt) for every plugin manager and for configuration.

## Commands

| Command | Description |
| --- | --- |
| `Package License Viewer: Refresh License Annotations` | Re-read local metadata, lockfiles and Cargo workspace declarations, then redraw. Run it after changing dependencies. |
| `Package License Viewer: Clear License Cache` | Delete all cached registry results. |
| `Package License Viewer: Toggle Inline License Annotations` | Turn the annotations on or off. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `packageLicenseViewer.enabled` | `true` | Show inline license annotations. |
| `packageLicenseViewer.format` | `${license}` | Template for the annotation text. Placeholders: `${license}`, `${version}`, `${name}`, `${source}`, `${nodeEngine}`, `${rubyVersion}`, `${rustVersion}`, `${goVersion}`, `${phpVersion}`. |
| `packageLicenseViewer.showResolvedVersion` | `false` | Append the resolved version, e.g. `MIT · 4.17.21`. |
| `packageLicenseViewer.showNodeEngine` | `true` | Append the package's `engines.node` range, when it has one, e.g. `MIT (Node: >=20)`. |
| `packageLicenseViewer.showRubyVersion` | `true` | Append a gem's `required_ruby_version` range, when it has one, e.g. `MIT (Ruby: >=3.0)`. |
| `packageLicenseViewer.showRustVersion` | `true` | Append a crate's `rust-version` (MSRV), when it has one, e.g. `MIT (Rust: >=1.56)`. |
| `packageLicenseViewer.showGoVersion` | `true` | Append a module version's `go` directive, when it has one, e.g. `MIT (Go: >=1.21)`. |
| `packageLicenseViewer.showPhpVersion` | `true` | Append a package's `require.php` constraint, when it has one, e.g. `MIT (PHP: >=8.1)`. |
| `packageLicenseViewer.unknownText` | `""` | Text shown when the license is unknown. Leave it empty to show nothing. |
| `packageLicenseViewer.annotationColor` | `editorCodeLens.foreground` | Color of the annotation except the license part: a theme color ID or a CSS color such as `#88888899`. |
| `packageLicenseViewer.licenseColor` | `charts.green` | Color of the license part of the annotation: a theme color ID or a CSS color. |
| `packageLicenseViewer.margin` | `0 0 0 1.5em` | CSS margin before the annotation. |
| `packageLicenseViewer.cacheTtlHours` | `168` | How many hours cached registry results stay valid. `0` disables the on-disk cache. |
| `packageLicenseViewer.requestTimeoutMs` | `8000` | Timeout for each registry request, in milliseconds. |
| `packageLicenseViewer.maxConcurrentRequests` | `8` | Maximum number of registry requests sent at the same time. |
| `packageLicenseViewer.npm.enabled` | `true` | Enable annotations for `package.json`. |
| `packageLicenseViewer.npm.registry` | `https://registry.npmjs.org` | Base URL of the npm registry. |
| `packageLicenseViewer.npm.useRegistry` | `true` | Allow registry lookups. Set to `false` to stay fully offline. |
| `packageLicenseViewer.npm.useLockfiles` | `true` | Read lockfiles to get the exact locked versions. |
| `packageLicenseViewer.npm.sections` | 4 standard sections | Sections that are always annotated. |
| `packageLicenseViewer.npm.autoDetectSections` | `true` | Also annotate other top-level objects whose key ends with `dependencies`. |
| `packageLicenseViewer.npm.pnpmWorkspaceCatalogs` | `true` | Also annotate the `catalog:` and `catalogs:` sections of `pnpm-workspace.yaml`. |
| `packageLicenseViewer.jsr.enabled` | `true` | Enable annotations for Deno manifests and import maps. |
| `packageLicenseViewer.jsr.registry` | `https://jsr.io` | JSR registry base URL. |
| `packageLicenseViewer.jsr.apiUrl` | `https://api.jsr.io` | Base URL of the JSR API, which provides the license. |
| `packageLicenseViewer.crates.enabled` | `true` | Annotate dependency declarations in `Cargo.toml`. |
| `packageLicenseViewer.crates.useRegistry` | `true` | Allow crates.io requests. When disabled, existing cached public metadata can still be used. |
| `packageLicenseViewer.crates.useLockfiles` | `true` | Prefer a uniquely matching crates.io version in the applicable `Cargo.lock`. |
| `packageLicenseViewer.moonbit.enabled` | `true` | Annotate dependency declarations in `moon.mod` / `moon.mod.json`. |
| `packageLicenseViewer.moonbit.useRegistry` | `true` | Allow mooncakes.io requests. When disabled, installed modules, the local registry index and existing cached metadata are still used. |
| `packageLicenseViewer.moonbit.useRegistryIndex` | `true` | Read the registry index `moon update` keeps in `$MOON_HOME/registry/index`, so an installed toolchain resolves without any request. |
| `packageLicenseViewer.go.enabled` | `true` | Annotate the requirements in `go.mod`. |
| `packageLicenseViewer.go.useRegistry` | `true` | Allow deps.dev requests, and reads of a version's `go.mod` from the Go module proxy for its `go` directive. Modules matching `GOPRIVATE`, `GONOPROXY` or `GONOSUMDB` are never looked up either way. When disabled, existing cached metadata is still used. |
| `packageLicenseViewer.rubygems.enabled` | `true` | Annotate dependency declarations in `Gemfile` and `*.gemspec`. |
| `packageLicenseViewer.rubygems.useRegistry` | `true` | Allow rubygems.org requests. When disabled, existing cached metadata can still be used. |
| `packageLicenseViewer.rubygems.useLockfiles` | `true` | Prefer a uniquely matching rubygems.org version in `Gemfile.lock`. |
| `packageLicenseViewer.composer.enabled` | `true` | Annotate the `require` and `require-dev` sections of `composer.json`. |
| `packageLicenseViewer.composer.useLockfiles` | `true` | Read `composer.lock` for the locked version and its license when nothing is installed under `vendor/`. |
| `packageLicenseViewer.composer.useRegistry` | `true` | Allow Packagist requests. When disabled, installed packages, `composer.lock` and existing cached metadata are still used. |

## Command line and CI

Use the `plv` CLI to report dependency licenses or check them against an allowlist or denylist. See the [CLI guide](docs/cli.md) for build instructions, JSON output, and an efm-langserver configuration example.

To support another manifest format, load your own [custom provider](docs/cli.md#custom-providers) with `--provider`.

## Contributing

To add a new ecosystem, implement one interface: `LicenseProvider`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture and the contribution workflow.

## Contributors

<a href="https://github.com/otnc/package-license-viewer/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=otnc/package-license-viewer" />
</a>

## Author

otoneko. https://github.com/otnc

## License

[MIT](LICENSE)
