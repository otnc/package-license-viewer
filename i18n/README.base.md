# Package License Viewer

[![VS Code Marketplace Version](https://vsmarketplacebadges.dev/version/otoneko1102.package-license-viewer.svg)](https://marketplace.visualstudio.com/items?itemName=otoneko1102.package-license-viewer)
[![VS Code Marketplace Installs](https://vsmarketplacebadges.dev/installs-short/otoneko1102.package-license-viewer.svg)](https://marketplace.visualstudio.com/items?itemName=otoneko1102.package-license-viewer)
[![Vim/NeoVim](https://img.shields.io/badge/Vim%2FNeoVim-experimental-yellow)](doc/package_license_viewer.txt)
[![CI](https://github.com/otnc/package-license-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/otnc/package-license-viewer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/otnc/package-license-viewer)](LICENSE)

:::kiritan{locale=en}
Shows the license of every dependency inline at the end of the line, with the license itself colored so it stands out at a glance.
:::

:::kiritan{locale=ja}
依存パッケージ1つ1つのライセンスを、行末にインラインで表示します。ライセンス部分は色分けされるので、一目で見分けられます。
:::

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

:::kiritan{locale=en}
Hover an annotation to see the resolved version, where the information came from, and a link to the package homepage.
:::

:::kiritan{locale=ja}
注釈にカーソルを合わせると、解決されたバージョン、情報の取得元、パッケージのホームページへのリンクが表示されます。
:::

::docs-table{id=supported-languages}

:::kiritan{locale=en}
See [docs/resolution-details.md](docs/resolution-details.md) for exactly how each language resolves a license, per-package-manager notes, and known metadata gaps (e.g. JSR).
:::

:::kiritan{locale=ja}
各言語ごとのライセンス解決の詳細、パッケージマネージャーごとの注意点、既知のメタデータの欠落(JSRなど)については [docs/resolution-details.md](docs/resolution-details.md) を参照してください(英語のみ)。
:::

::docs-table{id=editors}

:::kiritan{locale=en}
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
:::

:::kiritan{locale=ja}
Vim/NeoVimプラグインはリポジトリ直下にあるので、どのプラグインマネージャーでも `otnc/package-license-viewer` を指定するだけでインストールできます。`rtp` オプションやbuildフックは要りません。

| プラグインマネージャー | エディタ | インストール |
| --- | --- | --- |
| [lazy.nvim](https://github.com/folke/lazy.nvim) | Neovim | `{ "otnc/package-license-viewer" }` |
| vim.pack | Neovim 0.12以降 | `vim.pack.add({ "https://github.com/otnc/package-license-viewer" })` |
| [mini.deps](https://github.com/echasnovski/mini.deps) | Neovim | `MiniDeps.add("otnc/package-license-viewer")` |
| [packer.nvim](https://github.com/wbthomason/packer.nvim) | Neovim | `use("otnc/package-license-viewer")` |
| [paq-nvim](https://github.com/savq/paq-nvim) | Neovim | `"otnc/package-license-viewer",` |
| [vim-plug](https://github.com/junegunn/vim-plug) | Vim / Neovim | `Plug 'otnc/package-license-viewer'` |
| [dein.vim](https://github.com/Shougo/dein.vim) | Vim / Neovim | `call dein#add('otnc/package-license-viewer')` |
| [vim-jetpack](https://github.com/tani/vim-jetpack) | Vim / Neovim | `Jetpack 'otnc/package-license-viewer'` |
| ネイティブパッケージ(`:help packages`) | Vim / Neovim | `~/.vim/pack/plugins/start/` に `git clone` |

Node.js 22以降とnpmが `$PATH` に必要です。言語サーバーは対応ファイルを初めて開いたとき(と更新後)にバックグラウンドでビルドされます。各マネージャーの書き方と設定は [`:help package_license_viewer`](doc/package_license_viewer.txt) を参照してください(英語のみ)。
:::

::docs-table{id=commands}

::docs-table{id=settings}

:::kiritan{locale=en}
## Command line and CI

Use the `plv` CLI to report dependency licenses or check them against an allowlist or denylist. See the [CLI guide](docs/cli.md) for build instructions, JSON output, and an efm-langserver configuration example.
:::

:::kiritan{locale=ja}
## CLI と CI

`plv` を使うと、コマンドラインで依存関係のライセンスを確認し、CI で許可リストや禁止リストと照合できます。ビルド手順、JSON 出力、efm-langserver の設定例は [CLI ガイド](docs/cli.md)（英語）を参照してください。
:::

:::kiritan{locale=en}
## Contributing

Adding a new ecosystem is one interface: `LicenseProvider`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture and contribution workflow.
:::

:::kiritan{locale=ja}
## コントリビュート

新しいエコシステムを追加するのに必要なのは `LicenseProvider` というインターフェース1つだけです。アーキテクチャと開発フローについては [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。
:::

## %{contributorsHeading}

<a href="https://github.com/otnc/package-license-viewer/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=otnc/package-license-viewer" />
</a>

## %{authorHeading}

otoneko. https://github.com/otnc

## %{licenseHeading}

[MIT](LICENSE)
