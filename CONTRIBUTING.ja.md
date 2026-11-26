# 貢献について

[English](CONTRIBUTING.md) | **日本語**

このプロジェクトに関心を持っていただき、ありがとうございます。このファイルでは、アーキテクチャ、新しいエコシステムの追加方法、ローカルでの実行方法、リリース手順を説明します。拡張機能でできることは [README.md](README.md) を参照してください。

## 言語について

コードのコメントとドキュメント(README、このファイルなど)は英語で書きます。ソースコードを読む人がだれでも理解できるようにするためです。

コミットメッセージ、Issue、プルリクエストは英語と日本語のどちらで書いても構いません。書きやすいほうを選んでください。言語を理由にコントリビュートをためらう必要はありません。

件名をどちらの言語で書く場合も、[Conventional Commits](https://www.conventionalcommits.org/) のタイプ(`feat:`、`fix:`、`docs:`、`chore:` など)は英語で書いてください。`CHANGELOG.md` はこのタイプをもとに生成され(後述の「変更履歴」を参照)、生成ツールは英語のタイプ名しか認識しないためです。

## アーキテクチャ

設計の中心は [`LicenseProvider`](packages/core/src/providers/types.ts) というインターフェース1つです。プロバイダーはマニフェストを依存関係のリストに変換し(`parse`)、それぞれのライセンスを調べます(`resolve`)。プロバイダーは [`packages/core/src/providers/index.ts`](packages/core/src/providers/index.ts) に登録します。新しいプロバイダーを追加するとき、共通部分のコードで必要な変更はこの登録だけです。

VS Code 拡張、LSP サーバー、[CLI](docs/cli.md) は、`packages/core` のプロバイダーを共通で使います。

プロバイダー自身が扱わなくてよい処理は、次の共通モジュールにまとめています。

- [`packages/vscode-extension/src/annotator.ts`](packages/vscode-extension/src/annotator.ts): デバウンス、キャンセル処理、同時実行数の制限、ちらつかない再描画、デコレーションとホバーの描画
- [`packages/core/src/cache.ts`](packages/core/src/cache.ts): TTL 付きの2段階(メモリとディスク)のキャッシュ
- [`packages/core/src/net.ts`](packages/core/src/net.ts): タイムアウトとキャンセルに対応した fetch と、同時実行数を制限する小さなリミッター

npm プロバイダー([`packages/core/src/providers/npm/`](packages/core/src/providers/npm/))は、`node_modules`、ロックファイル、レジストリの順に3段階で解決します。各段階は [`installed.ts`](packages/core/src/providers/npm/installed.ts)、[`lockfile/`](packages/core/src/providers/npm/lockfile/)、[`registry.ts`](packages/core/src/providers/npm/registry.ts) に分かれています。JSR プロバイダー([`packages/core/src/providers/jsr/`](packages/core/src/providers/jsr/))は、`npm:` 指定子には npm のレジストリクライアントをそのまま使い、npm 互換名の `@jsr/scope__name` は JSR に問い合わせます。

エコシステムごとの具体的な解決方法(npm と JSR の優先順位、パッケージマネージャーごとのディレクトリ構成、Cargo の探索順)は [docs/resolution-details.md](docs/resolution-details.md) を参照してください(英語のみ)。

### Cargoの実装

Cargoの実装は [`packages/core/src/providers/crates/`](packages/core/src/providers/crates/) にあります。`parse.ts` は位置情報を保持するMITライセンスの `toml-eslint-parser` 0.10.0 (CommonJS、Node >=16対応)を使用しています。この依存関係を変更する際は、拡張機能がサポートする最小のVS Codeバージョンを維持してください。TOML 1.0の宣言は、その最初の行または依存関係テーブルのヘッダーを注釈の位置として使用します。不正なTOMLはエントリを生成しません。Cargoのバージョン要件はnpmの範囲指定とは独立して解釈されます。Rust の `semver::VersionReq` の結果を保存したテスト用の正解データ(オラクル)と、生成した Cargo.lock のフィクスチャについては [`cargo-provenance.md`](test/fixtures/lockfiles/cargo-provenance.md) で説明しています。

`workspace.ts` と `lockfile.ts` は宣言と一意に一致する公開バージョンを探すだけです。`client.ts` は送信開始のリミッター(1秒に1リクエスト)を全クライアント間で共有し、HTTP通信には `fetchJson` を使用します。`/versions` リクエストは意図的に `per_page` を省略しています。[APIの実装](https://github.com/rust-lang/crates.io/blob/main/src/controllers/krate/versions.rs)ではこのモードで全バージョンを返すためです。別ページの存在を示すレスポンスは、完了とみなさず拒否します。バージョンレコードには `license` が含まれるため、候補選定のために個々のバージョンへリクエストする必要はありません。レコードには `rust_version` も含まれ、リリースの MSRV としてライセンスの横に表示します (`>=` の範囲に正規化)。メタデータのキャッシュキーにはバージョン (`v2`) を付けています。v1 のレコードにはこのフィールドが無いためです。ロックされた正確なバージョンには、yank されたものも含めてバージョン別エンドポイントを使用します。一時的な失敗は `LicenseCache` に書き込まれません。HTTP 429の場合、自動リトライなしで以降の送信を少なくとも1分間遅延させます。

マニフェスト解決キーと公開バージョンのメタデータキーは分けて管理してください。前者はURI、エイリアス、セクション、ソース、要件、ワークスペースのコンテキストを含み、後者はドキュメント間で正確な公開メタデータを共有します。`invalidate()` は補助的な読み込みをクリアし、保留中のCargoリクエストをキャンセルします。Cargoコマンドの実行、アーカイブの読み込み、ソースキャッシュ、ファイルシステムウォッチャー、依存関係グラフのいずれもここには含まれません。

### MoonBitの実装

MoonBitの実装は [`packages/core/src/providers/moonbit/`](packages/core/src/providers/moonbit/) にあります。moonは `moon.mod.json` を小さなDSLである `moon.mod` に置き換えている途中のため、両方をパースします。[`dsl.ts`](packages/core/src/providers/moonbit/dsl.ts) は[公開されている文法](https://docs.moonbitlang.com/en/latest/toolchain/moon/module.html)に対するトークナイザーで、必要な部分(トップレベルの `import` ブロック内の文字列、`key = "string"`、`key = [ … ]`)だけを読み取り、認識できないものはすべてスキップします。そのため、途中まで書きかけの文があっても、その上に書かれた依存関係が消えることはありません。[`parse.ts`](packages/core/src/providers/moonbit/parse.ts) は両方の形式を同じエントリ形式に変換し、各 `import` の項目をmoonの `read_module_from_dsl` と同じように**最後の** `@` で分割します。

宣言されたバージョンは正確な `semver::Version` であり、範囲指定ではありません。moonは[minimal version selection](https://github.com/moonbitlang/moon/blob/main/crates/mooncake/src/resolver/mvs.rs)で解決するためです。ここでは範囲を解釈する処理は一切なく、`moon` コマンドも実行しません。解決順序は [`.mooncakes`](packages/core/src/providers/moonbit/installed.ts) → `moon.work` メンバー → [レジストリインデックス](packages/core/src/providers/moonbit/registryIndex.ts) → [mooncakes.io](packages/core/src/providers/moonbit/client.ts) で、最初の2つは `moon build` が展開したマニフェストを読みます。minimal version selection が実際に選んだバージョンが分かるのは、この展開済みのマニフェストだけです。また、この2つは宣言されたバージョンを検証する**前に**確認します。moon は `moon.work` メンバーの `@version` を内容に関係なく無視するので、先にバージョンを検証すると、仮のバージョンを書いたメンバーを「スキップ」ではなく「解決できない」と誤って報告してしまいます。

レジストリインデックスは、`moon update` が `$MOON_HOME/registry/index`(デフォルトは `~/.moon`)に維持しているクローンで、モジュールごとに1つのJSON Lines形式のファイルに、すべてのバージョン**とそのライセンス**が記録されています。そのため、ツールチェーンをインストールしていればオフラインで解決できます。壊れた行があってもファイル全体は捨てず、その行だけを読み飛ばす動作を保ってください。crates.io クライアントも不正なバージョンレコードを同じように扱います。

mooncakes.io は `/api/v0/modules/<user>/<module>@<version>` でそのリリースのメタデータを、`…/<user>/<module>` で最新版のメタデータを返します。最新版はあとから変わるので、バージョンを指定した応答だけをキャッシュします。インデックスには `moonbitlang/lex/runtime` のようなネストした名前も載っていますが、この API にはネストした名前を指定する**形式がありません**。そのため、そうしたモジュールはディスクからだけ解決し、開けないホバーリンクを付けてはいけません。レジストリはレート制限を公表していないので、`maxConcurrentRequests` の上限まで同時に送らず、間隔を空けて送ります。HTTP 429 が返ったら、リトライせずに1分間送信を止めます。

`moon` コマンドの実行、アーカイブのダウンロード、`.mbt` のパース、パッケージレベル(`moon.pkg`)の扱い、依存関係グラフのいずれもここには含まれません。

### Goの実装

Goの実装は [`packages/core/src/providers/go/`](packages/core/src/providers/go/) にあります。[`parse.ts`](packages/core/src/providers/go/parse.ts) は `golang.org/x/mod/modfile` の字句規則(1行に1ディレクティブ、`//` コメント、`verb ( … )` ブロック、ダブルクォートとバッククォートの文字列)に従い、`require` と `replace` だけを読みます。`replace` はパースの時点で適用します。goコマンドと同じく、バージョン指定の置き換えがワイルドカードの置き換えより優先されます。置き換え先がディレクトリならその `require` の項目はスキップし、モジュールなら置き換え先のモジュールとして解決します。

`require` に書かれるバージョンは、範囲ではなく1つの正確なバージョンです。goコマンドはminimal version selectionを使い、Go 1.17以降はメインモジュールの `go.mod` に、ビルドに必要なすべてのモジュールが選ばれたバージョンで書かれるためです。範囲を解釈する処理はなく、`go` コマンドも実行しません。

ライセンスは [`client.ts`](packages/core/src/providers/go/client.ts) から [deps.dev](https://docs.deps.dev/api/v3/) の `GetVersion` に問い合わせて取得します。モジュールミラーはライセンスのメタデータを配信しておらず、pkg.go.devにもそのためのAPIがないためです。`licenses` に複数のエントリがあるのはモジュール内にライセンスファイルが複数あるということなので、`AND` でつなぎます。`non-standard` は除外します。キャッシュするのはライセンスが見つかった応答だけです。公開直後のリリースは、まだdeps.devに取り込まれていないことがあります。ホバーから `https://pkg.go.dev/<module>@<version>` にリンクするのは、deps.dev がそのバージョンについて応答したあとだけです。deps.dev が応答したことで、そのモジュールが公開されていると判断できるためです。

[`env.ts`](packages/core/src/providers/go/env.ts) は `GOPRIVATE`、`GONOPROXY`、`GONOSUMDB` をプロセスの環境変数から、次にgoのenvファイル(`$GOENV`、または `os.UserConfigDir()` 配下の `go/env`)から読み、`module.MatchPrefixPatterns` と同じ方法で照合します。一致したモジュールはリクエストの前にスキップするので、プライベートモジュールのパスがマシンの外に出ることはありません。このチェックは必ずすべてのネットワーク呼び出しより前に置いてください。deps.dev が持っていない唯一の項目である各バージョンの `go` ディレクティブは、モジュールプロキシ上のそのバージョン自身の `go.mod` から読みます。ライセンスの横に添える補足情報なので、読み取りに失敗してもライセンスの結果は変わりません。

`go` コマンドの実行、モジュールキャッシュやライセンスファイルの読み込み、`go.sum`/`go.work` の扱い、依存関係グラフのいずれもここには含まれません。

### Rubyの実装

Rubyの実装は [`packages/core/src/providers/rubygems/`](packages/core/src/providers/rubygems/) にあります。[`parse.ts`](packages/core/src/providers/rubygems/parse.ts) は、Gemfile の `gem` 呼び出しと gemspec の `add_dependency` 系という2つの形式を読むのに必要な分だけ Ruby をトークン化し、コードは実行しません。`git:`/`github:`/`path:` オプションと、デフォルトでない `source` の下で宣言された gem はパースの時点でスキップするので、それらの名前が rubygems.org に送られることはありません。バージョン要件は [`spec.ts`](packages/core/src/providers/rubygems/spec.ts) で `Gem::Requirement` と同じ方法で解釈し、npm や Cargo の範囲とは独立しています。

[`lockfile.ts`](packages/core/src/providers/rubygems/lockfile.ts) は宣言の特定と、一意に一致する公開バージョンの選択だけを行います。インデックス化するのは、remote が公開ソースである Gemfile.lock の `GEM` セクションだけです。[`client.ts`](packages/core/src/providers/rubygems/client.ts) は `GET /api/v1/versions/<name>.json` を読みます。このレスポンスは公開済みの全バージョンとそのライセンスを1回で返すので (crates.io クライアントと同じ形です)、候補の選択にバージョンごとのリクエストは不要です。1つのリリースのプラットフォーム別ビルドは1レコードにまとめます。gemspec の `licenses` リストはそのリリースが配布されるすべてのライセンスを列挙したものなので、複数エントリは `AND` でつなぎます。

同じレスポンスには各リリースの `ruby_version` (`required_ruby_version`) も含まれ、npm の `engines.node` と同じ形でライセンスの横に表示します。制約なしは `>= 0` と報告されるので、その場合は何も表示しません。

`ruby` や `bundle` の実行、インストール済み gem の読み込み、依存関係グラフのいずれもここには含まれません。

### Composerの実装

Composerの実装は [`packages/core/src/providers/composer/`](packages/core/src/providers/composer/) にあります。[`parse.ts`](packages/core/src/providers/composer/parse.ts) は jsonc-parser の AST から `require` と `require-dev` を読み、名前を小文字にそろえ(`composer.lock`、`installed.json`、Packagist はいずれも小文字でパッケージを管理しています)、プラットフォームパッケージ(`php`、`ext-*`、`lib-*`、`composer-*-api`)は捨てます。これらはライセンスを持つパッケージではなく、PHP 自体への制約だからです。あわせて `config.vendor-dir`、`minimum-stability`、`prefer-stable`、`repositories` が Packagist を無効化しているかどうかも読み取ります。

解決は npm と同じく vendor → lock → レジストリの順に進みます。[`installed.ts`](packages/core/src/providers/composer/installed.ts) は `<vendor-dir>/composer/installed.json`(Composer 2 のオブジェクト形式と Composer 1 の配列形式の両方)を読みます。Composer はホイスティングをしないので、親ディレクトリは探索しません。[`lockfile.ts`](packages/core/src/providers/composer/lockfile.ts) は `composer.lock` を読み、[`client.ts`](packages/core/src/providers/composer/client.ts) は Packagist の p2 エンドポイントに問い合わせます。ディスク上の2つのファイルはどちらも各パッケージの `license` を持っているので、そこで見つかればライセンスまで分かります。[`metadata.ts`](packages/core/src/providers/composer/metadata.ts) は3つの情報源を1つの `PackageRecord` に変換し、3つに共通する規則もここにまとめています。`license` 配列は Composer の定義では「いずれかを選べる」という意味なので、`OR` でつなぎます。Go で deps.dev の結果を `AND` でつなぐのとは逆です。レコードの `require.php` は `phpVersion` になります。ホバータイトルの Packagist へのリンクは、レコードの `notification-url` が Packagist のもの(または p2 由来)であるときだけ付けるので、`path`/`vcs` 由来のパッケージに 404 になるリンクは付きません。

vendor や lock のバージョンは、マニフェストの制約を今も満たしている場合にだけ報告します。そのため、古くなった lock は誤ったバージョンを報告せず、Packagist での解決に進みます。`dev-*` ブランチは、制約自身の `as` 句、レコードの `extra.branch-alias`、lock の `aliases` というエイリアスを通じて制約を満たせます。これは Composer 自身が `^1.0` を `dev-main` で満たせるようにしている仕組みと同じです。ブランチが Packagist から解決されることはありません。

[`spec.ts`](packages/core/src/providers/composer/spec.ts) は `composer/semver`(`VersionParser::normalize`、`parseConstraints`、`parseStability`、PHP の `version_compare`)の移植で、npm や Cargo の範囲指定とは独立しています。実際のライブラリが生成した TSV のオラクルに対してテストされており、再生成の方法は [`composer-provenance.md`](test/fixtures/lockfiles/composer-provenance.md) に書いてあります。説明文とオラクルが食い違うときは、オラクルの結果に合わせてください。lock がない場合の候補選定は Composer の安定度ルールに従います。明示的な `@flag` はそのパッケージについて `minimum-stability` を置き換え、制約に書かれたプレリリースは下限を下げ、`prefer-stable` はより高い不安定版よりも安定版を優先します。p2 のレスポンスは minified 形式(各バージョンは前のバージョンから変わったキーだけを持ち、`"__unset"` はキーの削除を表す)なので、読む前に展開します。展開済みのリストはキャッシュしますが、見つからなかった結果はキャッシュしません。p2 は静的な CDN 配信の JSON なので、リクエストは `maxConcurrentRequests` の範囲で並列に送りますが、HTTP 429 が返った場合はすべてのクライアントが1分間送信を止め、リトライはしません。

`composer` コマンドの実行、プライベートリポジトリ(Private Packagist、Satis、`vcs`/`path` リポジトリ)、`COMPOSER_VENDOR_DIR` の扱い、`replace`/`provide` の解決、依存関係グラフのいずれもここには含まれません。

## 別のエコシステムを追加する

`LicenseProvider` を実装して登録し、拡張機能の起動条件と設定を追加します。

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

[`packages/core/src/providers/index.ts`](packages/core/src/providers/index.ts) に登録し、[`packages/vscode-extension/package.json`](packages/vscode-extension/package.json) の `activationEvents` に対象の言語を追加してください。

README の英語版と日本語版にある対応言語の表は、[`i18n/supported-languages.json`](i18n/supported-languages.json) から生成しています。ここにも行を追加してください。その言語の Issue があって「対応予定」の行がある場合は、その行を削除してください。共通のセルは一度だけ書き、言語によって異なるセルだけ `{ "en": "…", "ja": "…" }` で指定します。

### ホバータイトルをパッケージのレジストリページにリンクする

どのプロバイダーも、npm や JSR と同じようにホバーのタイトルをクリックできるようにしてください。タイトルがただのテキストのままのプロバイダーは追加しないでください。`resolve()` では、レジストリの URL の形に合うほうの `LicenseInfo` フィールドを設定します。

- `registryPackageName`: リンク先が本当に `https://www.npmjs.com/package/<name>/v/<version>` である場合(npmおよびnpm互換エイリアスのみ。それ以外はこれを設定すべきではありません)。
- `packagePageUrl`: それ以外のレジストリでのページの正確な URL。例: `https://crates.io/crates/<name>/<version>` や `https://pypi.org/project/<name>/<version>/`。JSRはこちらを使用しています。

[`packages/core/src/format.ts`](packages/core/src/format.ts) の `buildHover` はどちらか設定されている方を選び(両方設定されていれば `registryPackageName` が優先)、`` `name@version` `` というタイトルに自動でリンクを付けます。このリンクを自分で組み立てないでください。設定するときに大事な点が2つあります。

- **エイリアスを先に解決する。** リンクはローカルのマニフェストキーではなく、実際のレジストリパッケージを指す必要があります。npmプロバイダーが `registryPackageName` を設定する前に `npm:` エイリアスを実際のパッケージまでたどっている処理を参照してください(`packages/core/src/providers/npm/index.ts`)。
- **そのレジストリに実在しないものにリンクしない。** `file:`/`git`/ローカルパスの依存関係や、確信が持てないものについては、404になり得るURLにリンクするより、両方のフィールドを未設定のままにしてください。

レジストリが本当に別途宣言されたホームページを公開している場合は、通常どおり `homepage` に設定してください。`buildHover` は、`Homepage` の行がタイトルのリンクと同じ URL になる場合はその行を表示しません(独自のホームページを持たない JSR がこれに当たります)。

レジストリがパッケージのソースリポジトリも公開している場合は、同じように `repository` を設定してください。`buildHover` はそれを `Homepage` リンクの横に表示し、URL が `github.com` のものなら GitHub のロゴ付きで `GitHub`、それ以外なら `Repository` というラベルで表示します。レジストリが宣言する値は、まずブラウザで開ける `https:` URLに正規化してください。npm の `repository` フィールドだけでも6種類ほどの書き方があり、[`normalizeRepositoryUrl`](packages/core/src/providers/repository.ts) がそれらを1つの形にそろえます。Composer の `source` レコードもこの関数で処理します。URL をパッケージ名から推測して作らず、分からないときは `repository` を未設定のままにしてください。

Python への対応は予定していますが、まだ実装していません。現在の状況は [README.md](README.md#サポート言語) からリンクされているIssueを参照してください。以下のメタデータエンドポイントが役立つかもしれません。

- PyPI: `https://pypi.org/pypi/<name>/<version>/json` → `info.license` / `info.classifiers`
- [deps.dev](https://docs.deps.dev/api/v3/) の `GetVersion` は、Goと同じくPyPIについても `licenses` を返します

## ドキュメントとi18n

`README.md`、`README.ja.md`、`CONTRIBUTING.md`、`CONTRIBUTING.ja.md` は [Kiritan](https://github.com/otnc/kiritan) によって [`i18n/`](i18n/) 内のベースソースから生成されます。生成されたファイルは直接編集しないでください。次のビルドで警告なしに上書きされます。代わりに `i18n/README.base.md` や `i18n/CONTRIBUTING.base.md` を編集してから、以下を実行してください。

```sh
npm run docs:build   # ローカライズされたドキュメントをすべて再生成する
npm run docs:check   # 未翻訳・古くなった内容が残っていないか確認する
```

ディレクティブの構文やCLIリファレンスの詳細については、[AGENTS.md](AGENTS.md) と [`.agents/skills/kiritan`](.agents/skills/kiritan/SKILL.md) にインストールされているKiritanのスキルを参照してください。

READMEの表には、このプロジェクト独自の `::docs-table{id=...}` を使います。共通のセルと翻訳は [`i18n/supported-languages.json`](i18n/supported-languages.json)、[`i18n/editors.json`](i18n/editors.json)、[`i18n/commands.json`](i18n/commands.json)、[`i18n/settings.json`](i18n/settings.json) で管理します。列の順序は各ファイルの `columns` のキー順で決まります。共通のセルは文字列で、翻訳するセルは `{ "en": "…", "ja": "…" }` で書きます。セルにはMarkdownのリンクやコード表記も使えます。

コマンドの行はコマンドID、設定の行は設定IDをキーにします。コマンド名、設定名、初期値、行の順序は [`packages/vscode-extension/package.json`](packages/vscode-extension/package.json) から取得するため、表のファイルでは説明文を編集します。追加したコマンドや設定の説明がない場合や、削除したIDの説明が残っている場合は、`docs:build` がエラーになります。`npm.sections` の行は、`defaultSummary` に `%{count}` を使って配列の初期値を説明するため、要素数を書き直す必要はありません。

[`i18n/readme-renderer.mjs`](i18n/readme-renderer.mjs) のレンダラーが、解析時に表のディレクティブを展開します。通常の文章はbaseファイルで管理し、英語の節と対応する日本語の節を隣に置きます。同じコード例などの共通部分は言語別ブロックの外に置き、一度の編集で済むようにします。

## エージェント向けスキル

AI コーディングエージェント向けの追加の指示(スキル)は、[`skills` CLI](https://www.npmjs.com/package/skills)(`npx skills`)で [`.agents/skills/`](.agents/skills/) に入れています。コミットしているのは `.agents/skills/` と [`skills-lock.json`](skills-lock.json) だけです。各エージェントが参照するほかの場所(`.claude/skills/`、`agent/skills/` など)は、ここから作られるシンボリックリンクかコピーで、gitignore しています。クローンしたあとは、次のコマンドで作り直してください。

```sh
npx skills experimental_install
```

新しいスキルを追加するには:

```sh
npx skills add <owner>/<repo> --agent '*' -y
```

このコマンドはソースをクローンし、スキルのファイルを `.agents/skills/<name>/` にコピーします。さらに、ローカルにある各エージェント用のディレクトリにシンボリックリンクかコピーを作り、`skills-lock.json` にソースとハッシュを記録します。コミットするのは `.agents/skills/` と `skills-lock.json` の変更だけです。ほかのエージェント用ディレクトリは追跡しないでください([`.gitignore`](.gitignore) を参照)。

## 開発

```sh
npm install
npm run watch:vscode # esbuildをwatchモードで実行
# VS CodeでF5を押すとExtension Development Hostが起動します
```

2つの起動構成が用意されています。**Run Extension** は空のExtension Development Hostを開きます。**Run Extension (MoonBit sample)** はその中で [`test/fixtures/moonbit-workspace/`](test/fixtures/moonbit-workspace/) を開きます。これは各フォーマットのマニフェストを1つずつと、展開済みの `.mooncakes` モジュールを持つ、2メンバー構成の `moon.work` です。そのため、ホストの起動が終わるとすぐに注釈を確認できます。どちらの場合も、ホスト内で `File > Open Folder` を実行すれば実際のプロジェクトに切り替えられます。

```sh
npm run format:check     # prettier --check .
npm run lint             # eslint .
npm run check-types      # tsc --noEmit
npm test                 # 実際のロックファイルフィクスチャに対するユニットテスト
npm run test:integration # 実際のVS Code内で拡張機能を実行するテスト
npm run package           # .vsixをビルド
```

[`test/fixtures/lockfiles/`](test/fixtures/lockfiles/) 内のロックファイルは、同じマニフェストに対して実際に `npm`、`pnpm`、`yarn`(classicとberry)、`bun` でインストールして生成したものです。そのため、パーサーは手書きのサンプルではなく実物に対してテストされています。

`npm test` はTypeScriptのソースに対して直接Vitestを実行します。事前にコンパイルする必要はありません。`packages/vscode-extension` のテストスイートは、加えてビルド済みの `dist/extension.js` が存在する場合はそれも読み込みます。バンドル自体が拡張機能を壊すことがあるためです。エントリーポイントが `require()` の呼び出しを実行時まで遅延させる依存関係は、ソースに対しては問題なく解決されても、拡張機能ホスト内では失敗することがあります。このチェックをスキップさせずに実行するには、先に `npm run compile` を実行してください。

Cargo、MoonBit、Go、Composerはそれぞれ専用のIntegrationテスト用ワークスペースを持ち、`Cargo.toml`、`moon.mod`、`go.mod` はプレーンテキストに関連付けられています。プロバイダーの振り分けが言語の登録に依存していないことを確かめるためです。`composer.json` は JSON のままにして、npm プロバイダーが処理しないことを確認しています。ドキュメントを開いたり拡張機能のコマンドを呼び出したりする前の自動アクティベーションを確認したうえで、URIベースのワークスペース/ロックファイルの読み込み、キャッシュされたメタデータ、ホバーのリンク、未保存のパース、設定をテストします。このフィクスチャではレジストリへのアクセスは無効化されています。最小サポートのホストで動作確認するには、`npm run test:integration` を実行する際に `PLV_VSCODE_VERSION=1.90.0` を設定してください。指定しない場合は現在の安定版ホストが使用されます。

コミット前に `npm run format` を実行してください。CIでは `format:check` と `lint` が強制されます。

## テスト

テストの対象に合わせて実行環境を分けています。

- **CLI のスモークテスト**は、ビルド済みの CLI を別プロセスで起動して動作を確かめます。`npm run compile:cli` のあとに `node --test packages/cli/test/cli.test.mjs` を実行してください。

- **ユニットテスト**はVitestで実行され、パッケージごとに1つのプロジェクトに分かれています(リポジトリルートの `vitest.config.ts` が `test.projects` で両者をまとめています)。[`packages/core/test/*.test.ts`](packages/core/test/) はプロバイダー・キャッシュ・フォーマット関連のソースを直接 import します。コンパイルは不要で、実際の `vscode` もほとんど使いません。これらのテストは特定のエディタではなく、インメモリのフェイクホスト([`test/support/fakeHost.ts`](packages/core/test/support/fakeHost.ts))を通じて `ProviderHost`/`FileSystemLike`/`UriLike` の抽象化そのものをテストしているためです。`config.ts`/`log.ts`/`format.ts` の中で依然として実際の `vscode` API を値として呼び出す一部分(`workspace.getConfiguration`、`window.createOutputChannel`、`MarkdownString`)は、`vitest.config.ts` の `resolve.alias` で `"vscode"` としてエイリアスした小さなスタブ([`test/support/vscodeStub.ts`](packages/core/test/support/vscodeStub.ts))経由で動きます。[`packages/vscode-extension/test/unit/*.test.ts`](packages/vscode-extension/test/unit/) は `Annotator` と `extension.ts` を、同じエイリアス方式によるより本格的な独自の `vscode` スタブ(`Uri`/デコレーション/コマンドなども含む)に対してテストし、加えてビルド済みの実際の `dist/extension.js` が存在する場合はそれも、そのテストファイルだけに限定した `Module._load` パッチ経由で読み込みます。バンドル自体が拡張機能を壊すことがあり、ソースではなく実際に配布するバンドルを確認できるのは、この `require()` だけだからです。

- **Integrationテスト**([`packages/vscode-extension/test/integration/*.test.ts`](packages/vscode-extension/test/integration/))は `@vscode/test-cli` を使って実際のVS Code内で実行します。Vitestではなく、そのパッケージ自身の `tsc` パス(`npm run build-tests`)でコンパイルされます。Vitestは実際の拡張機能ホストのプロセス内では実行できないためです。

[`test/fixtures/`](test/fixtures/) には、npm、pnpm、Yarn、Bun で生成したロックファイルとサンプルワークスペースを置いています。各テストで共通して使います。

プロバイダーの追加や解決ロジックの変更を行う際は、[`packages/core/test/`](packages/core/test/) 内の既存のテストの隣にユニットテストを追加してください。対象のエコシステムの形に近いもの、`npm.test.ts`(npm/JSR)、`crates.test.ts`(Cargo)、`moonbit.test.ts`(MoonBit)、`go.test.ts`(Go)、`rubygems.test.ts`(Ruby)、`composer.test.ts`(Composer)のいずれかに倣ってください。Integrationテストが必要になるのは、実際のVS Codeホスト(アクティベーション、`vscode.workspace.fs`、実際の設定)に本当に依存する挙動を検証する場合だけです。各テストスイートは [`test/fixtures/workspace/`](test/fixtures/workspace/)、[`test/fixtures/cargo-workspace/`](test/fixtures/cargo-workspace/)、[`test/fixtures/moonbit-workspace/`](test/fixtures/moonbit-workspace/)、[`test/fixtures/go-workspace/`](test/fixtures/go-workspace/)、[`test/fixtures/ruby-workspace/`](test/fixtures/ruby-workspace/)、[`test/fixtures/composer-workspace/`](test/fixtures/composer-workspace/) のフィクスチャを共通で使っています。

## リリース

[`.github/workflows/release.yml`](.github/workflows/release.yml) は Actions タブから手動で実行します。バージョンとして、上げ方のキーワード(`patch`、`minor`、`major`、`prerelease`)か `1.0.0` のような具体的なバージョンを指定すると、あとはワークフローが次の処理を行います。

1. 型チェック、ユニットテスト、実際のVS Code上でのIntegrationテストスイートを実行
2. `package.json` をバンプし、最後のタグ以降のConventional Commitsから `CHANGELOG.md` を更新
3. `i18n/*.base.md` から `README.md`/`README.ja.md`/`CONTRIBUTING.md`/`CONTRIBUTING.ja.md` を再生成(`npm run docs:build`)。これにより、生成済みドキュメントがベースソースと同期しないままリリースされることがなくなります
4. `.vsix` をビルド
5. VS Code Marketplaceに公開
6. コミット(手順3で再生成されたドキュメントも含む)、タグ付け、push を行い、`.vsix` を添付した GitHub Release を作成
7. 別のジョブで、同じ `.vsix` を [Open VSX](https://open-vsx.org/) に公開

トークンが設定されていないレジストリへの公開は自動でスキップされるので、トークンを用意する前でもこのワークフローを使えます。トークンはリポジトリシークレットとして追加してください。

- `VSCE_PAT`: Marketplace → Manage スコープを持つ Azure DevOps の PAT。<https://marketplace.visualstudio.com/manage> で発行します
- `OVSX_PAT`: `otoneko1102` 名前空間に公開できる Open VSX のアクセストークン([Publishing Extensions](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions) を参照)

### 変更履歴

`CHANGELOG.md` は [git-cliff](https://git-cliff.org)(設定は [`cliff.toml`](cliff.toml))を使って、最後のタグ以降のコミットメッセージから[Conventional Commits](https://www.conventionalcommits.org/)のタイプ別に生成されます。対応は `feat` → Added、`fix` → Fixed、`perf` → Performance、`refactor`/`revert` → Changed です。それ以外(`chore`、`docs`、`test`、`style`、`ci`、`build`、`release`、マージコミット)は、手書きで管理していた頃と同じく載せません。コミットの件名はほぼそのまま変更履歴の行になるので、それを意識して書いてください。

ファイルを変更せずに、次のリリースのエントリを確認するには次のコマンドを実行します。

```sh
npx git-cliff --unreleased --tag vX.Y.Z
```

タグ付けは公開が成功したあとにだけ行うので、リリースが失敗してもタグは残りません。`dry_run` にチェックを入れると、公開、コミット、タグ付けをせずにパイプライン全体を試せます。

ローカルから公開するには、`.env.example` を `.env` にコピーして `VSCE_PAT` を設定し、`npm run publish` を実行してください(`npm run publish -- patch` のように上げ方も指定できます)。この方法で公開されるのは VS Code Marketplace だけです。
