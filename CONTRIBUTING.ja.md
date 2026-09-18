# 貢献について

[English](CONTRIBUTING.md) | **日本語**

見てくれてありがとうございます。このファイルではアーキテクチャ、新しいエコシステムの追加方法、ローカルでの実行方法、リリース手順について説明しています。拡張機能自体の機能については [README.md](README.md) を参照してください。

## 言語について

コードコメントとドキュメント(README、このファイルなど)は英語で書かれています。ソースコードを読む誰にとっても近づきやすいプロジェクトであるためです。

コミットメッセージ、Issue、プルリクエストは英語・日本語どちらで書いても構いません。使いやすい方を選んでください — 言語がコントリビュートしない理由になってしまわないように。

件名の残りをどちらの言語で書く場合でも、[Conventional Commits](https://www.conventionalcommits.org/) のタイププレフィックス(`feat:`、`fix:`、`docs:`、`chore:` など)は英語のまま書いてください。`CHANGELOG.md` はこの部分からそのまま生成されており(後述の「変更履歴」を参照)、生成ツールは英語のタイプ名しか認識しません。

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

## ドキュメントとi18n

`README.md`、`README.ja.md`、`CONTRIBUTING.md`、`CONTRIBUTING.ja.md` は [Kiritan](https://github.com/otnc/kiritan) によって [`i18n/`](i18n/) 内のベースソースから生成されます — 生成後のファイルを直接編集しないでください。次のビルドで黙って上書きされます。代わりに `i18n/README.base.md` や `i18n/CONTRIBUTING.base.md` を編集してから、以下を実行してください。

```sh
npm run docs:build   # ローカライズされたドキュメントをすべて再生成する
npm run docs:check   # 未翻訳・古くなった内容が残っていないか確認する
```

ディレクティブの構文やCLIリファレンスの詳細については、[AGENTS.md](AGENTS.md) と [`.agents/skills/kiritan`](.agents/skills/kiritan/SKILL.md) にインストールされているKiritanのスキルを参照してください。

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

## テスト

2つの階層に分かれているのは意図的な設計であり、整理すべき不統一ではありません。

- **ユニットテスト**([`test/*.test.js`](test/))はNode標準の `node:test` を使い、手書きの `vscode` スタブ([`test/vscode-stub.js`](test/vscode-stub.js))とコンパイル済みの `out/` 配下の成果物に対して実行します。テスト用の `tsc` ビルドステップも、実際のVS Codeも、mochaも使いません。プレーンなJavaScriptのままにしているのは意図的です — これにより `npm test` が高速に動き、TypeScriptだけでテストしていたら見逃していたようなバンドル自体のバグも検出できます(前述の「`npm test` はビルド済みの `dist/extension.js` も読み込みます」を参照)。
- **Integrationテスト**([`src/test/integration/*.test.ts`](src/test/integration/))は `@vscode/test-cli` を使って実際のVS Code内で実行します。実際の `vscode` モジュールとその型を直接使うため、TypeScriptで書かれています。

プロバイダーの追加や解決ロジックの変更を行う際は、`test/` 内の既存のテストの隣にユニットテストを追加してください。対象のエコシステムの形に近い方、[`index.test.js`](test/index.test.js)(npm/JSR)か [`crates.test.js`](test/crates.test.js)(Cargo)のどちらかに倣ってください。Integrationテストが必要になるのは、実際のVS Codeホスト(アクティベーション、`vscode.workspace.fs`、実際の設定)に本当に依存する挙動を検証する場合だけです。両方のテストスイートは [`test/fixtures/workspace/`](test/fixtures/workspace/) と [`test/fixtures/cargo-workspace/`](test/fixtures/cargo-workspace/) のフィクスチャを共通で使っています。

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
