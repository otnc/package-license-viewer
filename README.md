# Package License Viewer

**English** | [日本語](README.ja.md)

[![VS Code Marketplace Version](https://vsmarketplacebadges.dev/version/otoneko1102.package-license-viewer.svg)](https://marketplace.visualstudio.com/items?itemName=otoneko1102.package-license-viewer)
[![VS Code Marketplace Installs](https://vsmarketplacebadges.dev/installs-short/otoneko1102.package-license-viewer.svg)](https://marketplace.visualstudio.com/items?itemName=otoneko1102.package-license-viewer)
[![Vim/NeoVim](https://img.shields.io/badge/Vim%2FNeoVim-experimental-yellow)](doc/package_license_viewer.txt)
[![CI](https://github.com/otnc/package-license-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/otnc/package-license-viewer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/otnc/package-license-viewer)](LICENSE)

Shows the license of every dependency inline at the end of the line, with the license itself colored so it stands out at a glance.

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

Hover an annotation to see the resolved version, where the information came from, and a link to the package homepage.

::docs-table{#supported-languages}

See [docs/resolution-details.md](docs/resolution-details.md) for exactly how each language resolves a license, per-package-manager notes, and known metadata gaps (e.g. JSR).

::docs-table{#editors}

The Vim/Neovim plugin lives at the repository root, so every plugin manager installs it from just `otnc/package-license-viewer`, with no `rtp` option or build hook:

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

It needs Node.js 22+ and npm on `$PATH`; the language server is built in the background the first time a supported file is opened, and again after an update. See [`:help package_license_viewer`](doc/package_license_viewer.txt) for every manager and for configuration.

::docs-table{#commands}

::docs-table{#settings}

## Contributing

Adding a new ecosystem is one interface: `LicenseProvider`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture and contribution workflow.

## Contributors

<a href="https://github.com/otnc/package-license-viewer/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=otnc/package-license-viewer" />
</a>

## Author

otoneko. https://github.com/otnc

## License

[MIT](LICENSE)
