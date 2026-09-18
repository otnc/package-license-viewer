# Package License Viewer

[English](README.md) | **日本語**

[![VS Code Marketplace Version](https://vsmarketplacebadges.dev/version/otoneko1102.package-license-viewer.svg)](https://marketplace.visualstudio.com/items?itemName=otoneko1102.package-license-viewer)
[![VS Code Marketplace Installs](https://vsmarketplacebadges.dev/installs-short/otoneko1102.package-license-viewer.svg)](https://marketplace.visualstudio.com/items?itemName=otoneko1102.package-license-viewer)
[![Vim/NeoVim](https://img.shields.io/badge/Vim%2FNeoVim-work%20in%20progress-yellow)](docs/vim-neovim-lsp-design.md)
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

## サポート言語

| 言語 | サポート状況 | パッケージマネージャー | 備考 |
| --- | --- | --- | --- |
| JavaScript / TypeScript | ✅ | npm, pnpm, yarn (classic / berry), bun | `package.json` に加え、`deno.json`/`jsr.json`/`import_map.json`、pnpmワークスペースカタログにも対応 |
| Deno / JSR | ✅ | jsr, `npm:` 指定子 | 上記と同じマニフェストを対象に、`jsr:` と `npm:` の両方の指定子を解決 |
| Rust | ✅ | Cargo | `Cargo.toml` の宣言をcrates.io / `Cargo.lock` と突き合わせて解決。ローカルにCargoのインストールは不要 |
| Python | ❌ | pip, uv, poetry | 対応予定 — [Issue #14](https://github.com/otnc/package-license-viewer/issues/14) |
| Ruby | ❌ | bundler, gem | 対応予定 — [Issue #15](https://github.com/otnc/package-license-viewer/issues/15) |
| Go | ❌ | go mod | 対応予定 — [Issue #16](https://github.com/otnc/package-license-viewer/issues/16) |
| MoonBit | ❌ | moon | 対応予定 — [Issue #13](https://github.com/otnc/package-license-viewer/issues/13) |

各言語ごとのライセンス解決の詳細、パッケージマネージャーごとの注意点、既知のメタデータの欠落(JSRなど)については [docs/resolution-details.md](docs/resolution-details.md) を参照してください(英語のみ)。

## エディタ

現時点ではVS Codeに対応しています。共通の言語サーバーを土台にしたVim/NeoVim対応は現在進行中です — [docs/vim-neovim-lsp-design.md](docs/vim-neovim-lsp-design.md) を参照してください(英語のみ)。

## コマンド

| コマンド | 説明 |
| --- | --- |
| `Package License Viewer: Refresh License Annotations` | ローカルのメタデータ、ロックファイル、Cargoワークスペースの宣言を読み直して再描画します。依存関係を変更した後に使用してください。 |
| `Package License Viewer: Clear License Cache` | レジストリからキャッシュした内容をすべて破棄します。 |
| `Package License Viewer: Toggle Inline License Annotations` | インラインのライセンス注釈のオン/オフを切り替えます。 |

## 設定

| 設定 | デフォルト値 | 説明 |
| --- | --- | --- |
| `packageLicenseViewer.enabled` | `true` | インラインのライセンス注釈を表示します。 |
| `packageLicenseViewer.format` | `${license}` | 注釈のテンプレート。プレースホルダー: `${license}`, `${version}`, `${name}`, `${source}`, `${nodeEngine}`。 |
| `packageLicenseViewer.showResolvedVersion` | `false` | 解決されたバージョンを付加します(例: `MIT · 4.17.21`)。 |
| `packageLicenseViewer.showNodeEngine` | `true` | パッケージに `engines.node` の指定があれば付加します(例: `MIT (Node: >=20)`)。 |
| `packageLicenseViewer.unknownText` | `""` | ライセンスが不明な場合に表示するテキスト。空文字なら何も表示しません。 |
| `packageLicenseViewer.annotationColor` | `editorCodeLens.foreground` | ライセンス部分以外に使うテーマカラーID、または `#88888899` のようなCSSカラー。 |
| `packageLicenseViewer.licenseColor` | `charts.green` | 注釈のライセンス部分だけに使うテーマカラーID、またはCSSカラー。 |
| `packageLicenseViewer.margin` | `0 0 0 1.5em` | 注釈の前に付けるCSSマージン。 |
| `packageLicenseViewer.cacheTtlHours` | `168` | キャッシュしたレジストリ結果の有効期間。`0` でディスクキャッシュを無効化します。 |
| `packageLicenseViewer.requestTimeoutMs` | `8000` | レジストリへの1リクエストあたりのタイムアウト。 |
| `packageLicenseViewer.maxConcurrentRequests` | `8` | レジストリへの並列リクエスト数。 |
| `packageLicenseViewer.npm.enabled` | `true` | `package.json` の注釈を有効にします。 |
| `packageLicenseViewer.npm.registry` | `https://registry.npmjs.org` | レジストリのベースURL。 |
| `packageLicenseViewer.npm.useRegistry` | `true` | レジストリへの問い合わせを許可します。`false` にすると完全オフラインで動作します。 |
| `packageLicenseViewer.npm.useLockfiles` | `true` | 正確なピン留めバージョンを得るためにロックファイルを読み込みます。 |
| `packageLicenseViewer.npm.sections` | 標準の4セクション | 常に注釈を付けるセクション。 |
| `packageLicenseViewer.npm.autoDetectSections` | `true` | キーが `dependencies` で終わるその他のトップレベルオブジェクトにも注釈を付けます。 |
| `packageLicenseViewer.npm.pnpmWorkspaceCatalogs` | `true` | `pnpm-workspace.yaml` の `catalog:` / `catalogs:` セクションにも注釈を付けます。 |
| `packageLicenseViewer.jsr.enabled` | `true` | Deno / import mapマニフェストの注釈を有効にします。 |
| `packageLicenseViewer.jsr.registry` | `https://jsr.io` | JSRレジストリのベースURL。 |
| `packageLicenseViewer.jsr.apiUrl` | `https://api.jsr.io` | ライセンス情報を取得するJSR APIのベースURL。 |
| `packageLicenseViewer.crates.enabled` | `true` | `Cargo.toml` の依存関係宣言に注釈を付けます。 |
| `packageLicenseViewer.crates.useRegistry` | `true` | crates.ioへのリクエストを許可します。無効にした場合もキャッシュ済みの公開メタデータは利用できます。 |
| `packageLicenseViewer.crates.useLockfiles` | `true` | 該当する `Cargo.lock` 内で一意に一致するcrates.ioのバージョンを優先します。 |

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
