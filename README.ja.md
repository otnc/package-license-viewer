# Package License Viewer

[English](README.md) | **日本語**

[![VS Code Marketplace Version](https://vsmarketplacebadges.dev/version/otoneko1102.package-license-viewer.svg)](https://marketplace.visualstudio.com/items?itemName=otoneko1102.package-license-viewer)
[![VS Code Marketplace Installs](https://vsmarketplacebadges.dev/installs-short/otoneko1102.package-license-viewer.svg)](https://marketplace.visualstudio.com/items?itemName=otoneko1102.package-license-viewer)
[![Vim/NeoVim](https://img.shields.io/badge/Vim%2FNeoVim-experimental-yellow)](doc/package_license_viewer.txt)
[![CI](https://github.com/otnc/package-license-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/otnc/package-license-viewer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/otnc/package-license-viewer)](LICENSE)

マニフェストに書かれた依存パッケージごとに、その行の末尾にライセンスを表示します。ライセンス部分には色が付くので、ひと目で分かります。

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

注釈にカーソルを合わせると、解決したバージョン、情報の取得元、パッケージのホームページとソースリポジトリへのリンクを表示します。

## サポート言語

| 言語 | サポート状況 | Version | パッケージマネージャー | 主なコントリビューター | 備考 |
| --- | --- | --- | --- | --- | --- |
| JavaScript / TypeScript | ✅ | ✅ | npm, pnpm, yarn (classic / berry), bun | [@otnc](https://github.com/otnc) | `package.json` に加え、`deno.json`/`jsr.json`/`import_map.json` と pnpm ワークスペースのカタログにも対応 |
| Deno / JSR | ✅ | ✅ | jsr, `npm:` 指定子 | [@otnc](https://github.com/otnc) | 上と同じマニフェストで、`jsr:` と `npm:` の両方の指定子を解決 |
| Go | ✅ | ✅ | go mod | [@otnc](https://github.com/otnc) | `go.mod` の `require` を、`replace` を反映したうえで deps.dev に問い合わせて解決。Go のインストールは不要。`GOPRIVATE` に一致するモジュールは問い合わせない |
| Rust | ✅ | ✅ | Cargo | [@bem130](https://github.com/bem130) | `Cargo.toml` の宣言を crates.io と `Cargo.lock` から解決。Cargo のインストールは不要 |
| MoonBit | ✅ | ❌ | moon | [@Allianaab2m](https://github.com/Allianaab2m) | `moon.mod` / `moon.mod.json` を `.mooncakes`、ローカルのレジストリインデックス、mooncakes.io の順に解決。`moon` のインストールは不要 |
| Ruby | ✅ | ✅ | bundler, gem | [@muse-chan](https://github.com/muse-chan) | `Gemfile` と `*.gemspec` の宣言を rubygems.org と `Gemfile.lock` から解決。Ruby のインストールは不要 |
| PHP | ✅ | ✅ | Composer | [@v420v](https://github.com/v420v) | `composer.json` の `require` を `vendor/`、`composer.lock`、Packagist の順に解決。PHP と Composer のインストールは不要 |
| Python | ❌ | ❌ | pip, uv, poetry |  | 対応予定([Issue #14](https://github.com/otnc/package-license-viewer/issues/14)) |
| あなたの言語? |  |  |  |  | ここにない言語の対応も歓迎します。[Issue](https://github.com/otnc/package-license-viewer/issues) かプルリクエストを送ってください([CONTRIBUTING.md](CONTRIBUTING.md#adding-another-ecosystem) を参照)。 |

言語ごとのライセンスの解決方法、パッケージマネージャーごとの注意点、JSR のようにレジストリにライセンス情報がない既知のケースは、[docs/resolution-details.md](docs/resolution-details.md) を参照してください(英語のみ)。

## エディタ

| エディタ | サポート状況 | 備考 |
| --- | --- | --- |
| VS Code | ✅ | インライン注釈、ホバー、`packageLicenseViewer.*` のすべての設定に対応します。 |
| Neovim | ✅ (実験的) | インライン注釈、ホバー、設定に対応します。同梱の Node 製言語サーバーと Lua のレイヤー(`vim.lsp.start()`、`nvim_buf_set_extmark()`)で動きます。言語サーバーは初回利用時に npm で自動ビルドされます。詳しくは `:help package_license_viewer` を参照してください(英語のみ)。 |
| Vim | ✅ (実験的) | Neovim と同じ機能に対応します。プラグインに含まれる VimScript 製の LSP クライアント(`job`/`channel` + `prop_add`/`popup_atcursor`)で動きます。`+job`、`+channel`、`+textprop` を備えた Vim 9.0 以降が必要です。詳しくは `:help package_license_viewer` を参照してください(英語のみ)。 |

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

## コマンド

| コマンド | 説明 |
| --- | --- |
| `Package License Viewer: Refresh License Annotations` | ローカルのメタデータ、ロックファイル、Cargo ワークスペースの宣言を読み直して再描画します。依存関係を変更したあとに実行してください。 |
| `Package License Viewer: Clear License Cache` | レジストリから取得してキャッシュした結果をすべて削除します。 |
| `Package License Viewer: Toggle Inline License Annotations` | ライセンスの注釈の表示と非表示を切り替えます。 |

## 設定

| 設定 | デフォルト値 | 説明 |
| --- | --- | --- |
| `packageLicenseViewer.enabled` | `true` | インラインのライセンス注釈を表示します。 |
| `packageLicenseViewer.format` | `${license}` | 注釈のテンプレート。使えるプレースホルダーは `${license}`、`${version}`、`${name}`、`${source}`、`${nodeEngine}`、`${rubyVersion}`、`${rustVersion}`、`${goVersion}`、`${phpVersion}` です。 |
| `packageLicenseViewer.showResolvedVersion` | `false` | 解決したバージョンを後ろに付けます(例: `MIT · 4.17.21`)。 |
| `packageLicenseViewer.showNodeEngine` | `true` | パッケージに `engines.node` の指定があれば後ろに付けます(例: `MIT (Node: >=20)`)。 |
| `packageLicenseViewer.showRubyVersion` | `true` | gem に `required_ruby_version` の指定があれば後ろに付けます(例: `MIT (Ruby: >=3.0)`)。 |
| `packageLicenseViewer.showRustVersion` | `true` | crate に `rust-version` (MSRV) の指定があれば後ろに付けます(例: `MIT (Rust: >=1.56)`)。 |
| `packageLicenseViewer.showGoVersion` | `true` | モジュールのそのバージョンに `go` ディレクティブがあれば後ろに付けます(例: `MIT (Go: >=1.21)`)。 |
| `packageLicenseViewer.showPhpVersion` | `true` | パッケージに `require.php` の指定があれば後ろに付けます(例: `MIT (PHP: >=8.1)`)。 |
| `packageLicenseViewer.unknownText` | `""` | ライセンスが不明なときに表示するテキスト。空にすると何も表示しません。 |
| `packageLicenseViewer.annotationColor` | `editorCodeLens.foreground` | 注釈のうちライセンス以外の部分の色。テーマカラーの ID か、`#88888899` のような CSS の色を指定します。 |
| `packageLicenseViewer.licenseColor` | `charts.green` | 注釈のライセンス部分の色。テーマカラーの ID か CSS の色を指定します。 |
| `packageLicenseViewer.margin` | `0 0 0 1.5em` | 注釈の前に空ける余白。CSS の margin の値で指定します。 |
| `packageLicenseViewer.cacheTtlHours` | `168` | キャッシュしたレジストリの結果の有効期間(単位は時間)。`0` にするとディスクキャッシュを使いません。 |
| `packageLicenseViewer.requestTimeoutMs` | `8000` | レジストリへのリクエスト1件ごとのタイムアウト(ミリ秒)。 |
| `packageLicenseViewer.maxConcurrentRequests` | `8` | レジストリへ同時に送るリクエストの最大数。 |
| `packageLicenseViewer.npm.enabled` | `true` | `package.json` に注釈を表示します。 |
| `packageLicenseViewer.npm.registry` | `https://registry.npmjs.org` | npm レジストリのベース URL。 |
| `packageLicenseViewer.npm.useRegistry` | `true` | レジストリへの問い合わせを許可します。`false` にするとネットワークを使わずに動作します。 |
| `packageLicenseViewer.npm.useLockfiles` | `true` | ロックファイルを読み、ロックされた正確なバージョンを使います。 |
| `packageLicenseViewer.npm.sections` | 標準の4セクション | 常に注釈を表示するセクション。 |
| `packageLicenseViewer.npm.autoDetectSections` | `true` | キーが `dependencies` で終わるほかのトップレベルのオブジェクトにも注釈を表示します。 |
| `packageLicenseViewer.npm.pnpmWorkspaceCatalogs` | `true` | `pnpm-workspace.yaml` の `catalog:` と `catalogs:` にも注釈を表示します。 |
| `packageLicenseViewer.jsr.enabled` | `true` | Deno のマニフェストと import map に注釈を表示します。 |
| `packageLicenseViewer.jsr.registry` | `https://jsr.io` | JSR レジストリのベース URL。 |
| `packageLicenseViewer.jsr.apiUrl` | `https://api.jsr.io` | ライセンス情報を取得する JSR API のベース URL。 |
| `packageLicenseViewer.crates.enabled` | `true` | `Cargo.toml` の依存関係の宣言に注釈を表示します。 |
| `packageLicenseViewer.crates.useRegistry` | `true` | crates.io へのリクエストを許可します。無効にしても、キャッシュ済みの公開メタデータは使います。 |
| `packageLicenseViewer.crates.useLockfiles` | `true` | 該当する `Cargo.lock` に一致するバージョンが1つだけあれば、そのバージョンを優先します。 |
| `packageLicenseViewer.moonbit.enabled` | `true` | `moon.mod` / `moon.mod.json` の依存関係の宣言に注釈を表示します。 |
| `packageLicenseViewer.moonbit.useRegistry` | `true` | mooncakes.io へのリクエストを許可します。無効にしても、インストール済みのモジュール、ローカルのレジストリインデックス、キャッシュ済みのメタデータは使います。 |
| `packageLicenseViewer.moonbit.useRegistryIndex` | `true` | `moon update` が `$MOON_HOME/registry/index` に保存するレジストリインデックスを読みます。MoonBit のツールチェーンをインストールしていれば、リクエストを送らずに解決できます。 |
| `packageLicenseViewer.go.enabled` | `true` | `go.mod` の `require` に注釈を表示します。 |
| `packageLicenseViewer.go.useRegistry` | `true` | deps.dev へのリクエストを許可します。あわせて、`go` ディレクティブを取得するために Go モジュールプロキシから各バージョンの `go.mod` を読むことも許可します。`GOPRIVATE`、`GONOPROXY`、`GONOSUMDB` に一致するモジュールは、この設定に関係なく問い合わせません。無効にしても、キャッシュ済みのメタデータは使います。 |
| `packageLicenseViewer.rubygems.enabled` | `true` | `Gemfile` と `*.gemspec` の依存関係の宣言に注釈を表示します。 |
| `packageLicenseViewer.rubygems.useRegistry` | `true` | rubygems.org へのリクエストを許可します。無効にしても、キャッシュ済みのメタデータは使います。 |
| `packageLicenseViewer.rubygems.useLockfiles` | `true` | `Gemfile.lock` に一致するバージョンが1つだけあれば、そのバージョンを優先します。 |
| `packageLicenseViewer.composer.enabled` | `true` | `composer.json` の `require` と `require-dev` に注釈を表示します。 |
| `packageLicenseViewer.composer.useLockfiles` | `true` | `vendor/` に何もインストールされていないとき、`composer.lock` からロックされたバージョンとライセンスを読みます。 |
| `packageLicenseViewer.composer.useRegistry` | `true` | Packagist へのリクエストを許可します。無効にしても、インストール済みのパッケージ、`composer.lock`、キャッシュ済みのメタデータは使います。 |

## CLI と CI

`plv` CLI を使うと、依存関係のライセンスをコマンドラインで一覧にしたり、CI で許可リストや禁止リストと照合したりできます。ビルド手順、JSON 出力、efm-langserver の設定例は [CLI ガイド](docs/cli.md)(英語のみ)を参照してください。

ほかのマニフェスト形式に対応させたいときは、自作の[プロバイダー](docs/cli.md#custom-providers)を `--provider` で読み込めます。

## コントリビュート

新しいエコシステムに対応するには、`LicenseProvider` インターフェースを1つ実装するだけです。アーキテクチャと開発の流れは [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## コントリビューター

<a href="https://github.com/otnc/package-license-viewer/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=otnc/package-license-viewer" />
</a>

## 作者

otoneko. https://github.com/otnc

## ライセンス

[MIT](LICENSE)
