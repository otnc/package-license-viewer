# %{readmeTitle}

:::kiritan{locale=en}
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

## Supported languages

| Language | Support | Package managers | Notes |
| --- | --- | --- | --- |
| JavaScript / TypeScript | ✅ | npm, pnpm, yarn (classic & berry), bun | `package.json`, plus `deno.json`/`jsr.json`/`import_map.json` and pnpm workspace catalogs |
| Deno / JSR | ✅ | jsr, `npm:` specifiers | Same manifests as above — `jsr:` and `npm:` specifiers are both resolved |
| Rust | ✅ | Cargo | `Cargo.toml` declarations resolved against crates.io / `Cargo.lock`; no local Cargo install needed |
| Python | ❌ | pip, uv, poetry | Planned — [Issue #14](https://github.com/otnc/package-license-viewer/issues/14) |
| Ruby | ❌ | bundler, gem | Planned — [Issue #15](https://github.com/otnc/package-license-viewer/issues/15) |
| Go | ❌ | go mod | Planned — [Issue #16](https://github.com/otnc/package-license-viewer/issues/16) |
| MoonBit | ❌ | moon | Planned — [Issue #13](https://github.com/otnc/package-license-viewer/issues/13) |

See [docs/resolution-details.md](docs/resolution-details.md) for exactly how each language resolves a license, per-package-manager notes, and known metadata gaps (e.g. JSR).

## Editors

VS Code is supported today. Vim/Neovim support, backed by a shared language server, is in progress — see [docs/vim-neovim-lsp-design.md](docs/vim-neovim-lsp-design.md).

## Commands

| Command | Description |
| --- | --- |
| `Package License Viewer: Refresh License Annotations` | Re-read local metadata, lockfiles and Cargo workspace declarations, then redraw. Use after dependency changes. |
| `Package License Viewer: Clear License Cache` | Drop everything cached from the registries. |
| `Package License Viewer: Toggle Inline License Annotations` | Turn the annotations on or off. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `packageLicenseViewer.enabled` | `true` | Show inline license annotations. |
| `packageLicenseViewer.format` | `${license}` | Annotation template. Placeholders: `${license}`, `${version}`, `${name}`, `${source}`, `${nodeEngine}`. |
| `packageLicenseViewer.showResolvedVersion` | `false` | Append the resolved version, e.g. `MIT · 4.17.21`. |
| `packageLicenseViewer.showNodeEngine` | `true` | Append the package's `engines.node` range, when it has one, e.g. `MIT (Node: >=20)`. |
| `packageLicenseViewer.unknownText` | `""` | Text shown when the license is unknown. Empty means show nothing. |
| `packageLicenseViewer.annotationColor` | `editorCodeLens.foreground` | Theme color id, or a CSS color such as `#88888899`, for everything except the license itself. |
| `packageLicenseViewer.licenseColor` | `charts.green` | Theme color id, or a CSS color, used for just the license part of the annotation. |
| `packageLicenseViewer.margin` | `0 0 0 1.5em` | CSS margin before the annotation. |
| `packageLicenseViewer.cacheTtlHours` | `168` | Lifetime of cached registry results. `0` disables the on-disk cache. |
| `packageLicenseViewer.requestTimeoutMs` | `8000` | Timeout of a single registry request. |
| `packageLicenseViewer.maxConcurrentRequests` | `8` | Parallel registry requests. |
| `packageLicenseViewer.npm.enabled` | `true` | Enable annotations for `package.json`. |
| `packageLicenseViewer.npm.registry` | `https://registry.npmjs.org` | Registry base URL. |
| `packageLicenseViewer.npm.useRegistry` | `true` | Allow registry lookups. Set to `false` to stay fully offline. |
| `packageLicenseViewer.npm.useLockfiles` | `true` | Read lockfiles for exact pinned versions. |
| `packageLicenseViewer.npm.sections` | 4 standard sections | Sections that are always annotated. |
| `packageLicenseViewer.npm.autoDetectSections` | `true` | Also annotate other top-level objects whose key ends with `dependencies`. |
| `packageLicenseViewer.npm.pnpmWorkspaceCatalogs` | `true` | Also annotate the `catalog:` and `catalogs:` sections of `pnpm-workspace.yaml`. |
| `packageLicenseViewer.jsr.enabled` | `true` | Enable annotations for Deno / import map manifests. |
| `packageLicenseViewer.jsr.registry` | `https://jsr.io` | JSR registry base URL. |
| `packageLicenseViewer.jsr.apiUrl` | `https://api.jsr.io` | JSR API base URL, where the license lives. |
| `packageLicenseViewer.crates.enabled` | `true` | Annotate dependency declarations in `Cargo.toml`. |
| `packageLicenseViewer.crates.useRegistry` | `true` | Allow crates.io requests. When disabled, existing cached public metadata can still be used. |
| `packageLicenseViewer.crates.useLockfiles` | `true` | Prefer a uniquely matching crates.io version in the applicable `Cargo.lock`. |

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
:::

:::kiritan{locale=ja}
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
:::
