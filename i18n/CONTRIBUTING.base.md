# %{contributingTitle}

:::kiritan{locale=en}
Thanks for looking at this. This file covers the architecture, adding a new ecosystem, running the project locally, and releasing. For what the extension actually does, see [README.md](README.md).
:::

:::kiritan{locale=ja}
見てくれてありがとうございます。このファイルではアーキテクチャ、新しいエコシステムの追加方法、ローカルでの実行方法、リリース手順について説明しています。拡張機能自体の機能については [README.md](README.md) を参照してください。
:::

:::kiritan{locale=en}
## Language

Code comments and documentation (README, this file, etc.) are in English, so the project stays approachable to anyone reading the source.

Commit messages, issues and pull requests may be written in either English or Japanese, whichever you're more comfortable with — don't let the language be a reason not to contribute.
:::

:::kiritan{locale=ja}
## 言語について

コードコメントとドキュメント(README、このファイルなど)は英語で書かれています。ソースコードを読む誰にとっても近づきやすいプロジェクトであるためです。

コミットメッセージ、Issue、プルリクエストは英語・日本語どちらで書いても構いません。使いやすい方を選んでください — 言語がコントリビュートしない理由になってしまわないように。
:::

:::kiritan{locale=en}
## Architecture

Everything hangs off one interface, [`LicenseProvider`](src/providers/types.ts). A provider turns a manifest into a list of dependencies (`parse`) and resolves each one to a license (`resolve`). Providers are registered in [`src/providers/index.ts`](src/providers/index.ts); nothing else needs to change to add one.

Everything a provider doesn't have to worry about is shared:

- [`src/annotator.ts`](src/annotator.ts) — debouncing, cancellation, concurrency limits, flicker-free redrawing, decoration and hover rendering
- [`src/cache.ts`](src/cache.ts) — the two-level (in-memory + on-disk) cache with a TTL
- [`src/net.ts`](src/net.ts) — fetch with a timeout and cancellation, and a small concurrency limiter

The npm provider ([`src/providers/npm/`](src/providers/npm/)) resolves in three steps — `node_modules`, then the lockfile, then the registry — each in its own file ([`installed.ts`](src/providers/npm/installed.ts), [`lockfile/`](src/providers/npm/lockfile/), [`registry.ts`](src/providers/npm/registry.ts)). The JSR provider ([`src/providers/jsr/`](src/providers/jsr/)) reuses the npm registry client for `npm:` specifiers and routes `@jsr/scope__name` npm-compatibility names back to JSR.

For exactly how each ecosystem resolves a license (npm/JSR precedence, package-manager layouts, Cargo's lookup path), see [docs/resolution-details.md](docs/resolution-details.md).

### Cargo implementation

Cargo's implementation lives in [`src/providers/crates/`](src/providers/crates/). `parse.ts` uses the position-aware MIT-licensed `toml-eslint-parser` 0.10.0 (CommonJS, Node >=16 supported); keep the extension's minimum VS Code version when changing this dependency. TOML 1.0 declarations use their first line, or the dependency table header, as the annotation position. Invalid TOML yields no entries. Cargo requirements are interpreted independently of npm ranges; the saved Rust `semver::VersionReq` oracle and generated Cargo.lock fixture are described in [`cargo-provenance.md`](test/fixtures/lockfiles/cargo-provenance.md).

`workspace.ts` and `lockfile.ts` only locate declarations and uniquely matching public versions. `client.ts` shares a send-start limiter (one request per second) across clients and uses `fetchJson` for HTTP. Its `/versions` request deliberately omits `per_page`: the [API implementation](https://github.com/rust-lang/crates.io/blob/main/src/controllers/krate/versions.rs) returns all versions in this mode. A response advertising another page is rejected instead of being treated as complete. The version records carry `license`, so candidate selection needs no request for each individual version. Exact locked versions use the per-version endpoint, including yanked versions. Transient failures are never written to `LicenseCache`; HTTP 429 delays subsequent sends for at least one minute without automatic retries.

Keep manifest resolution keys separate from public version metadata keys. The former include the URI, alias, section, source, requirement and workspace context; the latter share exact public metadata across documents. `invalidate()` clears auxiliary reads and cancels pending Cargo requests. No Cargo command, archive reader, source cache, filesystem watcher or dependency graph belongs here.
:::

:::kiritan{locale=ja}
## アーキテクチャ

すべては [`LicenseProvider`](src/providers/types.ts) という1つのインターフェースにぶら下がっています。プロバイダーはマニフェストを依存関係のリストに変換し(`parse`)、それぞれをライセンスに解決します(`resolve`)。プロバイダーは [`src/providers/index.ts`](src/providers/index.ts) に登録されており、新しいプロバイダーを追加する際に他のファイルを変更する必要はありません。

プロバイダーが気にする必要のないことは、すべて共通化されています。

- [`src/annotator.ts`](src/annotator.ts) — デバウンス、キャンセル処理、並列数の制限、ちらつきのない再描画、デコレーションとホバーの描画
- [`src/cache.ts`](src/cache.ts) — TTL付きの2段(メモリ + ディスク)キャッシュ
- [`src/net.ts`](src/net.ts) — タイムアウトとキャンセルに対応したfetch、および小さな並列数リミッター

npmプロバイダー([`src/providers/npm/`](src/providers/npm/))は `node_modules` → ロックファイル → レジストリ、という3段階でそれぞれ別ファイル([`installed.ts`](src/providers/npm/installed.ts)、[`lockfile/`](src/providers/npm/lockfile/)、[`registry.ts`](src/providers/npm/registry.ts))に分けて解決します。JSRプロバイダー([`src/providers/jsr/`](src/providers/jsr/))は `npm:` 指定子に対してnpmのレジストリクライアントを再利用し、npm互換名 `@jsr/scope__name` をJSR側にルーティングします。

各エコシステムが具体的にどうライセンスを解決するか(npm/JSRの優先順位、パッケージマネージャーごとのレイアウト、Cargoの探索経路)については [docs/resolution-details.md](docs/resolution-details.md) を参照してください(英語のみ)。

### Cargoの実装

Cargoの実装は [`src/providers/crates/`](src/providers/crates/) にあります。`parse.ts` は位置情報を保持するMITライセンスの `toml-eslint-parser` 0.10.0 (CommonJS、Node >=16対応)を使用しています。この依存関係を変更する際は、拡張機能がサポートする最小のVS Codeバージョンを維持してください。TOML 1.0の宣言は、その最初の行または依存関係テーブルのヘッダーを注釈の位置として使用します。不正なTOMLはエントリを生成しません。Cargoのバージョン要件はnpmの範囲指定とは独立して解釈されます。保存済みのRust `semver::VersionReq` オラクルと生成された Cargo.lock フィクスチャについては [`cargo-provenance.md`](test/fixtures/lockfiles/cargo-provenance.md) で説明しています。

`workspace.ts` と `lockfile.ts` は宣言と一意に一致する公開バージョンを探すだけです。`client.ts` は送信開始のリミッター(1秒に1リクエスト)を全クライアント間で共有し、HTTP通信には `fetchJson` を使用します。`/versions` リクエストは意図的に `per_page` を省略しています。[APIの実装](https://github.com/rust-lang/crates.io/blob/main/src/controllers/krate/versions.rs)ではこのモードで全バージョンを返すためです。別ページの存在を示すレスポンスは、完了とみなさず拒否します。バージョンレコードには `license` が含まれるため、候補選定のために個々のバージョンへリクエストする必要はありません。ロックされた正確なバージョンには、ヤンクされたものも含めてバージョン別エンドポイントを使用します。一時的な失敗は `LicenseCache` に書き込まれません。HTTP 429の場合、自動リトライなしで以降の送信を少なくとも1分間遅延させます。

マニフェスト解決キーと公開バージョンのメタデータキーは分けて管理してください。前者はURI、エイリアス、セクション、ソース、要件、ワークスペースのコンテキストを含み、後者はドキュメント間で正確な公開メタデータを共有します。`invalidate()` は補助的な読み込みをクリアし、保留中のCargoリクエストをキャンセルします。Cargoコマンドの実行、アーカイブの読み込み、ソースキャッシュ、ファイルシステムウォッチャー、依存関係グラフのいずれもここには含まれません。
:::

:::kiritan{locale=en}
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

Register it in [`src/providers/index.ts`](src/providers/index.ts) and add the language to `activationEvents` in `package.json`.

Also add a row to the language/package-manager table in [README.md](README.md#supported-languages) (edit [`i18n/README.base.md`](i18n/README.base.md), not `README.md` — see "Documentation and i18n" below), and remove the corresponding "planned" row if there's a tracking issue for it.

### Link the hover title to the package's registry page

Every provider is expected to make the hover title clickable, the same way npm and JSR do — don't ship one that leaves it as plain text. Set one of these two `LicenseInfo` fields from `resolve()`, whichever fits the registry's URL shape:

- `registryPackageName` — when the target really is `https://www.npmjs.com/package/<name>/v/<version>` (npm and npm-compatible aliases only; nothing else should set this).
- `packagePageUrl` — the exact URL for anything else, e.g. `https://crates.io/crates/<name>/<version>` or `https://pypi.org/project/<name>/<version>/`. This is what JSR uses.

`buildHover` in [`src/format.ts`](src/format.ts) picks whichever is set (`registryPackageName` wins if somehow both are) and wraps it around the `` `name@version` `` title automatically — do not build that link yourself. Two things matter when you set it:

- **Resolve aliases first.** The link must point at the actual registry package, not the local manifest key — see how the npm provider follows an `npm:` alias to its real target before setting `registryPackageName` (`src/providers/npm/index.ts`).
- **Never link something that isn't really on that registry.** A `file:`/`git`/local-path dependency, or one you're not confident about, should leave both fields unset rather than link to a URL that might 404.

If the registry also exposes a genuine, separately-declared homepage, put that in `homepage` as usual — `buildHover` already drops the `Homepage` line when it would just repeat the title link (as it does for JSR, which has no separate homepage of its own).

Python, Ruby, Go and MoonBit support are planned but not implemented yet — see the open issues linked from [README.md](README.md#supported-languages) for current status. These metadata endpoints may be useful:

- PyPI: `https://pypi.org/pypi/<name>/<version>/json` → `info.license` / `info.classifiers`
- Go: `https://pkg.go.dev/<module>?tab=licenses` (no JSON API; needs the module proxy or scraping)
:::

:::kiritan{locale=ja}
## 別のエコシステムを追加する

`LicenseProvider` を実装し、登録し、有効化と設定を接続します。

```ts
export class ExampleLicenseProvider implements LicenseProvider {
  readonly id = "example";
  supports(document) { /* マニフェストを認識する */ }
  isEnabled() { return getSetting("example.enabled", true); }
  parse(document) { /* → DependencyEntry[] (name, spec, section, line) */ }
  cacheKey(entry) { /* 解決結果がドキュメント/ソースのコンテキストに依存する場合は含める */ }
  async resolve(entry, document, token) { /* → LicenseInfo */ }
}
```

[`src/providers/index.ts`](src/providers/index.ts) に登録し、`package.json` の `activationEvents` に対象の言語を追加してください。

また、[README.md](README.md#サポート言語) の言語/パッケージマネージャー表にも行を追加してください(`README.md` ではなく [`i18n/README.base.md`](i18n/README.base.md) を編集します — 詳しくは後述の「ドキュメントとi18n」を参照)。対応するトラッキングIssueがある場合は、その「対応予定」の行を削除してください。

### ホバータイトルをパッケージのレジストリページにリンクする

npmやJSRと同様に、すべてのプロバイダーはホバータイトルをクリック可能にすることが期待されています — 単なるプレーンテキストのままにしないでください。`resolve()` から、レジストリのURL形式に合う方の `LicenseInfo` フィールドを設定してください。

- `registryPackageName` — リンク先が本当に `https://www.npmjs.com/package/<name>/v/<version>` である場合(npmおよびnpm互換エイリアスのみ。それ以外はこれを設定すべきではありません)。
- `packagePageUrl` — それ以外の正確なURL。例: `https://crates.io/crates/<name>/<version>` や `https://pypi.org/project/<name>/<version>/`。JSRはこちらを使用しています。

[`src/format.ts`](src/format.ts) の `buildHover` はどちらか設定されている方を選び(両方設定されていれば `registryPackageName` が優先)、`` `name@version` `` というタイトルに自動的にリンクを付けます — このリンクを自分で組み立てないでください。設定する際に重要な点が2つあります。

- **エイリアスを先に解決する。** リンクはローカルのマニフェストキーではなく、実際のレジストリパッケージを指す必要があります。npmプロバイダーが `registryPackageName` を設定する前に `npm:` エイリアスを実際のターゲットまで辿っている様子を参照してください(`src/providers/npm/index.ts`)。
- **そのレジストリに実在しないものにリンクしない。** `file:`/`git`/ローカルパスの依存関係や、確信が持てないものについては、404になり得るURLにリンクするより、両方のフィールドを未設定のままにしてください。

レジストリが本当に別途宣言されたホームページを公開している場合は、通常どおり `homepage` に設定してください — `buildHover` は、タイトルリンクと重複するだけの場合は既に `Homepage` の行を省略します(JSRのように、独自のホームページを持たない場合がそうです)。

Python、Ruby、Go、MoonBitへの対応は予定されていますが、まだ実装されていません — 現在の状況は [README.md](README.md#サポート言語) からリンクされている各Issueを参照してください。以下のメタデータエンドポイントが役立つかもしれません。

- PyPI: `https://pypi.org/pypi/<name>/<version>/json` → `info.license` / `info.classifiers`
- Go: `https://pkg.go.dev/<module>?tab=licenses` (JSON APIはなし。モジュールプロキシかスクレイピングが必要)
:::

:::kiritan{locale=en}
## Documentation and i18n

`README.md`, `README.ja.md`, `CONTRIBUTING.md` and `CONTRIBUTING.ja.md` are generated by [Kiritan](https://github.com/otnc/kiritan) from the base sources in [`i18n/`](i18n/) — never hand-edit a generated file, it gets silently overwritten by the next build. Edit `i18n/README.base.md` or `i18n/CONTRIBUTING.base.md` instead, then run:

```sh
npm run docs:build   # regenerate every localized document
npm run docs:check   # verify nothing is left missing/stale
```

See [AGENTS.md](AGENTS.md) and the Kiritan skill installed at [`.agents/skills/kiritan`](.agents/skills/kiritan/SKILL.md) for the full directive syntax and CLI reference.
:::

:::kiritan{locale=ja}
## ドキュメントとi18n

`README.md`、`README.ja.md`、`CONTRIBUTING.md`、`CONTRIBUTING.ja.md` は [Kiritan](https://github.com/otnc/kiritan) によって [`i18n/`](i18n/) 内のベースソースから生成されます — 生成後のファイルを直接編集しないでください。次のビルドで黙って上書きされます。代わりに `i18n/README.base.md` や `i18n/CONTRIBUTING.base.md` を編集してから、以下を実行してください。

```sh
npm run docs:build   # ローカライズされたドキュメントをすべて再生成する
npm run docs:check   # 未翻訳・古くなった内容が残っていないか確認する
```

ディレクティブの構文やCLIリファレンスの詳細については、[AGENTS.md](AGENTS.md) と [`.agents/skills/kiritan`](.agents/skills/kiritan/SKILL.md) にインストールされているKiritanのスキルを参照してください。
:::

:::kiritan{locale=en}
## Development

```sh
npm install
npm run watch      # esbuild in watch mode
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
:::

:::kiritan{locale=ja}
## 開発

```sh
npm install
npm run watch      # esbuildをwatchモードで実行
# VS CodeでF5を押すとExtension Development Hostが起動します
```

```sh
npm run format:check     # prettier --check .
npm run lint             # eslint .
npm run check-types      # tsc --noEmit
npm test                 # 実際のロックファイルフィクスチャに対するユニットテスト
npm run test:integration # 実際のVS Code内で拡張機能を実行するテスト
npm run package           # .vsixをビルド
```

[`test/fixtures/lockfiles/`](test/fixtures/lockfiles/) 内のロックファイルは、同じマニフェストに対して実際に `npm`、`pnpm`、`yarn`(classicとberry)、`bun` でインストールして生成したものです。そのため、パーサーは手書きのサンプルではなく実物に対してテストされています。

`npm test` はビルド済みの `dist/extension.js` も読み込みます。バンドル自体が拡張機能を壊すことがあるためです。エントリーポイントが `require()` の呼び出しを実行時まで遅延させる依存関係は、`tsc` の下では問題なく解決されても、拡張機能ホスト内では失敗することがあります。

このチェックを飛ばさず、バンドルを実際に動かすために、ユニットテストの前にコンパイルしてください。CargoのIntegrationテストスイートは、TOMLをプレーンテキストに関連付けた、Cargo専用の別ワークスペースを起動します。ドキュメントを開いたり拡張機能のコマンドを呼び出したりする前の自動アクティベーションを確認したうえで、URIベースのワークスペース/ロックファイルの読み込み、キャッシュされたメタデータ、ホバーのリンク、未保存のパース、設定をテストします。このフィクスチャではレジストリへのアクセスは無効化されています。最小サポートのホストで動作確認するには、`npm run test:integration` を実行する際に `PLV_VSCODE_VERSION=1.90.0` を設定してください。指定しない場合は現在の安定版ホストが使用されます。

コミット前に `npm run format` を実行してください。CIでは `format:check` と `lint` が強制されます。
:::

:::kiritan{locale=en}
## Releasing

[`.github/workflows/release.yml`](.github/workflows/release.yml) is run by hand from the Actions tab. Give it a version — a bump keyword (`patch`, `minor`, `major`, `prerelease`) or an explicit version like `0.2.0` — and it does the rest:

1. type-check, unit tests, and the integration suite in a real VS Code
2. bump `package.json`, and update `CHANGELOG.md` from Conventional Commits since the last tag
3. build the `.vsix`
4. publish to the VS Code Marketplace
5. commit, tag and push, then create the GitHub Release with the `.vsix` attached

Publishing is skipped automatically when `VSCE_PAT` is absent, so the workflow is usable before you have a token. Get one from <https://marketplace.visualstudio.com/manage> — an Azure DevOps PAT with the Marketplace → Manage scope — and add it as a repository secret.

### Changelog

`CHANGELOG.md` is generated with [git-cliff](https://git-cliff.org) (config in [`cliff.toml`](cliff.toml)) from commit messages since the last tag, grouped by [Conventional Commits](https://www.conventionalcommits.org/) type — `feat` → Added, `fix` → Fixed, `perf` → Performance, `refactor`/`revert` → Changed. Everything else (`chore`, `docs`, `test`, `style`, `ci`, `build`, `release`, merge commits) is left out, the same way it always was when this was written by hand. Write commit subjects with that in mind — they end up as changelog lines close to verbatim.

To preview what the next release's entry would look like without touching anything:

```sh
npx git-cliff --unreleased --tag vX.Y.Z
```

Tagging happens only after publishing succeeded, so a failed release leaves no dangling tag. Tick `dry_run` to rehearse the whole pipeline without publishing, committing or tagging.

To publish locally instead, copy `.env.example` to `.env`, fill in `VSCE_PAT`, and run `npm run publish` (optionally `npm run publish -- patch`).
:::

:::kiritan{locale=ja}
## リリース

[`.github/workflows/release.yml`](.github/workflows/release.yml) はActionsタブから手動で実行します。バージョン — バンプ用のキーワード(`patch`、`minor`、`major`、`prerelease`)か、`0.2.0` のような明示的なバージョン — を指定すると、残りはワークフローが行います。

1. 型チェック、ユニットテスト、実際のVS Code上でのIntegrationテストスイートを実行
2. `package.json` をバンプし、最後のタグ以降のConventional Commitsから `CHANGELOG.md` を更新
3. `.vsix` をビルド
4. VS Code Marketplaceに公開
5. コミット、タグ付け、pushを行い、`.vsix` を添付したGitHub Releaseを作成

`VSCE_PAT` が存在しない場合は公開が自動的にスキップされるため、トークンを取得する前でもこのワークフローを使用できます。<https://marketplace.visualstudio.com/manage> から、Marketplace → Manage スコープを持つAzure DevOpsのPATを取得し、リポジトリシークレットとして追加してください。

### 変更履歴

`CHANGELOG.md` は [git-cliff](https://git-cliff.org)(設定は [`cliff.toml`](cliff.toml))を使って、最後のタグ以降のコミットメッセージから[Conventional Commits](https://www.conventionalcommits.org/)のタイプ別に生成されます — `feat` → Added、`fix` → Fixed、`perf` → Performance、`refactor`/`revert` → Changed。それ以外(`chore`、`docs`、`test`、`style`、`ci`、`build`、`release`、マージコミット)は、これまで手書きで管理していた頃と同様に除外されます。コミットの件名はそのまま変更履歴の行としてほぼそのまま使われることを意識して書いてください。

何も変更せずに次のリリースのエントリがどう見えるかをプレビューするには:

```sh
npx git-cliff --unreleased --tag vX.Y.Z
```

タグ付けは公開が成功した後にのみ行われるため、リリースが失敗してもタグが残ったままになることはありません。`dry_run` にチェックを入れると、公開・コミット・タグ付けを行わずにパイプライン全体をリハーサルできます。

ローカルから公開するには、`.env.example` を `.env` にコピーし、`VSCE_PAT` を設定した上で `npm run publish`(オプションで `npm run publish -- patch`)を実行してください。
:::
