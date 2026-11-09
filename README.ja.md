# Package License Viewer

[English](README.md) | **日本語**

[![VS Code Marketplace Version](https://vsmarketplacebadges.dev/version/otoneko1102.package-license-viewer.svg)](https://marketplace.visualstudio.com/items?itemName=otoneko1102.package-license-viewer)
[![VS Code Marketplace Installs](https://vsmarketplacebadges.dev/installs-short/otoneko1102.package-license-viewer.svg)](https://marketplace.visualstudio.com/items?itemName=otoneko1102.package-license-viewer)
[![Vim/NeoVim](https://img.shields.io/badge/Vim%2FNeoVim-experimental-yellow)](doc/package_license_viewer.txt)
[![CI](https://github.com/otnc/package-license-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/otnc/package-license-viewer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/otnc/package-license-viewer)](LICENSE)

依存パッケージ1つ1つのライセンスを、行末にインラインで表示します。ライセンス部分は色分けされるので、一目で見分けられます。

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

注釈にカーソルを合わせると、解決されたバージョン、情報の取得元、パッケージのホームページへのリンクが表示されます。

::docs-table{#supported-languages}

各言語ごとのライセンス解決の詳細、パッケージマネージャーごとの注意点、既知のメタデータの欠落(JSRなど)については [docs/resolution-details.md](docs/resolution-details.md) を参照してください(英語のみ)。

::docs-table{#editors}

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

::docs-table{#commands}

::docs-table{#settings}

## コントリビュート

新しいエコシステムを追加するのに必要なのは `LicenseProvider` というインターフェース1つだけです。アーキテクチャと開発フローについては [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## コントリビューター

<a href="https://github.com/otnc/package-license-viewer/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=otnc/package-license-viewer" />
</a>

## 作者

otoneko. https://github.com/otnc

## ライセンス

[MIT](LICENSE)
