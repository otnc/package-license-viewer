# Package License Viewer

[![VS Code Marketplace Version](https://vsmarketplacebadges.dev/version/otoneko1102.package-license-viewer.svg)](https://marketplace.visualstudio.com/items?itemName=otoneko1102.package-license-viewer)
[![VS Code Marketplace Installs](https://vsmarketplacebadges.dev/installs-short/otoneko1102.package-license-viewer.svg)](https://marketplace.visualstudio.com/items?itemName=otoneko1102.package-license-viewer)
[![Vim/NeoVim](https://img.shields.io/badge/Vim%2FNeoVim-experimental-yellow)](packages/vim-plugin)
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
The Vim/Neovim plugin lives at [`packages/vim-plugin`](packages/vim-plugin); see its `:help package_license_viewer` for setup and configuration.
:::

:::kiritan{locale=ja}
Vim/NeoVimプラグインは [`packages/vim-plugin`](packages/vim-plugin) にあります。セットアップと設定については `:help package_license_viewer` を参照してください(英語のみ)。
:::

::docs-table{id=commands}

::docs-table{id=settings}

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
