# Package License Viewer

[![VS Code Marketplace Version](https://vsmarketplacebadges.dev/version/otoneko1102.package-license-viewer.svg)](https://marketplace.visualstudio.com/items?itemName=otoneko1102.package-license-viewer)
[![VS Code Marketplace Installs](https://vsmarketplacebadges.dev/installs-short/otoneko1102.package-license-viewer.svg)](https://marketplace.visualstudio.com/items?itemName=otoneko1102.package-license-viewer)
[![Vim/NeoVim](https://img.shields.io/badge/Vim%2FNeoVim-experimental-yellow)](doc/package_license_viewer.txt)
[![CI](https://github.com/otnc/package-license-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/otnc/package-license-viewer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/otnc/package-license-viewer)](LICENSE)

:::kiritan{locale=en}
Shows each dependency's license at the end of its line in the manifest. The license is colored, so you can spot it at a glance.
:::

:::kiritan{locale=ja}
マニフェストに書かれた依存パッケージごとに、その行の末尾にライセンスを表示します。ライセンス部分には色が付くので、ひと目で分かります。
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
Hover an annotation to see the resolved version, where the information came from, and links to the package's homepage and source repository.
:::

:::kiritan{locale=ja}
注釈にカーソルを合わせると、解決したバージョン、情報の取得元、パッケージのホームページとソースリポジトリへのリンクを表示します。
:::

::docs-table{id=supported-languages}

:::kiritan{locale=en}
See [docs/resolution-details.md](docs/resolution-details.md) for how each language resolves a license, notes for each package manager, and known cases where the registry has no license data (such as JSR).
:::

:::kiritan{locale=ja}
言語ごとのライセンスの解決方法、パッケージマネージャーごとの注意点、JSR のようにレジストリにライセンス情報がない既知のケースは、[docs/resolution-details.md](docs/resolution-details.md) を参照してください(英語のみ)。
:::

::docs-table{id=editors}

:::kiritan{locale=en}
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
:::

:::kiritan{locale=ja}
Vim/Neovim プラグインはリポジトリの直下にあるので、どのプラグインマネージャーでも `otnc/package-license-viewer` を指定するだけでインストールできます。`rtp` オプションや build フックは要りません。

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

`$PATH` に Node.js 22 以降と npm が必要です。言語サーバーは、対応するファイルを初めて開いたときと、プラグインを更新したあとに、バックグラウンドでビルドされます。プラグインマネージャーごとの書き方と設定は [`:help package_license_viewer`](doc/package_license_viewer.txt) を参照してください(英語のみ)。
:::

::docs-table{id=commands}

::docs-table{id=settings}

:::kiritan{locale=en}
## Command line and CI

Use the `plv` CLI to report dependency licenses or check them against an allowlist or denylist. See the [CLI guide](docs/cli.md) for build instructions, JSON output, and an efm-langserver configuration example.

To support another manifest format, load your own [custom provider](docs/cli.md#custom-providers) with `--provider`.
:::

:::kiritan{locale=ja}
## CLI と CI

`plv` CLI を使うと、依存関係のライセンスをコマンドラインで一覧にしたり、CI で許可リストや禁止リストと照合したりできます。ビルド手順、JSON 出力、efm-langserver の設定例は [CLI ガイド](docs/cli.md)(英語のみ)を参照してください。

ほかのマニフェスト形式に対応させたいときは、自作の[プロバイダー](docs/cli.md#custom-providers)を `--provider` で読み込めます。
:::

:::kiritan{locale=en}
## Contributing

To add a new ecosystem, implement one interface: `LicenseProvider`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture and the contribution workflow.
:::

:::kiritan{locale=ja}
## コントリビュート

新しいエコシステムに対応するには、`LicenseProvider` インターフェースを1つ実装するだけです。アーキテクチャと開発の流れは [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。
:::

## %{contributorsHeading}

<a href="https://github.com/otnc/package-license-viewer/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=otnc/package-license-viewer" />
</a>

## %{authorHeading}

otoneko. https://github.com/otnc

## %{licenseHeading}

[MIT](LICENSE)
