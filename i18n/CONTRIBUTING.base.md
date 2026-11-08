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

Whichever language you write the rest of the subject in, keep the [Conventional Commits](https://www.conventionalcommits.org/) type prefix (`feat:`, `fix:`, `docs:`, `chore:`, …) in English — `CHANGELOG.md` is generated straight from it (see Changelog below), and the generator only recognizes the English type names.
:::

:::kiritan{locale=ja}
## 言語について

コードコメントとドキュメント(README、このファイルなど)は英語で書かれています。ソースコードを読む誰にとっても近づきやすいプロジェクトであるためです。

コミットメッセージ、Issue、プルリクエストは英語・日本語どちらで書いても構いません。使いやすい方を選んでください — 言語がコントリビュートしない理由になってしまわないように。

件名の残りをどちらの言語で書く場合でも、[Conventional Commits](https://www.conventionalcommits.org/) のタイププレフィックス(`feat:`、`fix:`、`docs:`、`chore:` など)は英語のまま書いてください。`CHANGELOG.md` はこの部分からそのまま生成されており(後述の「変更履歴」を参照)、生成ツールは英語のタイプ名しか認識しません。
:::

:::kiritan{locale=en}
## Architecture

Everything hangs off one interface, [`LicenseProvider`](packages/core/src/providers/types.ts). A provider turns a manifest into a list of dependencies (`parse`) and resolves each one to a license (`resolve`). Providers are registered in [`packages/core/src/providers/index.ts`](packages/core/src/providers/index.ts); nothing else needs to change to add one.

Everything a provider doesn't have to worry about is shared:

- [`packages/vscode-extension/src/annotator.ts`](packages/vscode-extension/src/annotator.ts) — debouncing, cancellation, concurrency limits, flicker-free redrawing, decoration and hover rendering
- [`packages/core/src/cache.ts`](packages/core/src/cache.ts) — the two-level (in-memory + on-disk) cache with a TTL
- [`packages/core/src/net.ts`](packages/core/src/net.ts) — fetch with a timeout and cancellation, and a small concurrency limiter

The npm provider ([`packages/core/src/providers/npm/`](packages/core/src/providers/npm/)) resolves in three steps — `node_modules`, then the lockfile, then the registry — each in its own file ([`installed.ts`](packages/core/src/providers/npm/installed.ts), [`lockfile/`](packages/core/src/providers/npm/lockfile/), [`registry.ts`](packages/core/src/providers/npm/registry.ts)). The JSR provider ([`packages/core/src/providers/jsr/`](packages/core/src/providers/jsr/)) reuses the npm registry client for `npm:` specifiers and routes `@jsr/scope__name` npm-compatibility names back to JSR.

For exactly how each ecosystem resolves a license (npm/JSR precedence, package-manager layouts, Cargo's lookup path), see [docs/resolution-details.md](docs/resolution-details.md).
:::

:::kiritan{locale=ja}
## アーキテクチャ

すべては [`LicenseProvider`](packages/core/src/providers/types.ts) という1つのインターフェースにぶら下がっています。プロバイダーはマニフェストを依存関係のリストに変換し(`parse`)、それぞれをライセンスに解決します(`resolve`)。プロバイダーは [`packages/core/src/providers/index.ts`](packages/core/src/providers/index.ts) に登録されており、新しいプロバイダーを追加する際に他のファイルを変更する必要はありません。

プロバイダーが気にする必要のないことは、すべて共通化されています。

- [`packages/vscode-extension/src/annotator.ts`](packages/vscode-extension/src/annotator.ts) — デバウンス、キャンセル処理、並列数の制限、ちらつきのない再描画、デコレーションとホバーの描画
- [`packages/core/src/cache.ts`](packages/core/src/cache.ts) — TTL付きの2段(メモリ + ディスク)キャッシュ
- [`packages/core/src/net.ts`](packages/core/src/net.ts) — タイムアウトとキャンセルに対応したfetch、および小さな並列数リミッター

npmプロバイダー([`packages/core/src/providers/npm/`](packages/core/src/providers/npm/))は `node_modules` → ロックファイル → レジストリ、という3段階でそれぞれ別ファイル([`installed.ts`](packages/core/src/providers/npm/installed.ts)、[`lockfile/`](packages/core/src/providers/npm/lockfile/)、[`registry.ts`](packages/core/src/providers/npm/registry.ts))に分けて解決します。JSRプロバイダー([`packages/core/src/providers/jsr/`](packages/core/src/providers/jsr/))は `npm:` 指定子に対してnpmのレジストリクライアントを再利用し、npm互換名 `@jsr/scope__name` をJSR側にルーティングします。

各エコシステムが具体的にどうライセンスを解決するか(npm/JSRの優先順位、パッケージマネージャーごとのレイアウト、Cargoの探索経路)については [docs/resolution-details.md](docs/resolution-details.md) を参照してください(英語のみ)。
:::

:::kiritan{locale=en}
### Cargo implementation

Cargo's implementation lives in [`packages/core/src/providers/crates/`](packages/core/src/providers/crates/). `parse.ts` uses the position-aware MIT-licensed `toml-eslint-parser` 0.10.0 (CommonJS, Node >=16 supported); keep the extension's minimum VS Code version when changing this dependency. TOML 1.0 declarations use their first line, or the dependency table header, as the annotation position. Invalid TOML yields no entries. Cargo requirements are interpreted independently of npm ranges; the saved Rust `semver::VersionReq` oracle and generated Cargo.lock fixture are described in [`cargo-provenance.md`](test/fixtures/lockfiles/cargo-provenance.md).

`workspace.ts` and `lockfile.ts` only locate declarations and uniquely matching public versions. `client.ts` shares a send-start limiter (one request per second) across clients and uses `fetchJson` for HTTP. Its `/versions` request deliberately omits `per_page`: the [API implementation](https://github.com/rust-lang/crates.io/blob/main/src/controllers/krate/versions.rs) returns all versions in this mode. A response advertising another page is rejected instead of being treated as complete. The version records carry `license`, so candidate selection needs no request for each individual version. They also carry `rust_version`, surfaced as the release's MSRV next to the license (normalized to a `>=` range); the metadata cache keys are versioned (`v2`) because v1 records predate that field. Exact locked versions use the per-version endpoint, including yanked versions. Transient failures are never written to `LicenseCache`; HTTP 429 delays subsequent sends for at least one minute without automatic retries.

Keep manifest resolution keys separate from public version metadata keys. The former include the URI, alias, section, source, requirement and workspace context; the latter share exact public metadata across documents. `invalidate()` clears auxiliary reads and cancels pending Cargo requests. No Cargo command, archive reader, source cache, filesystem watcher or dependency graph belongs here.
:::

:::kiritan{locale=ja}
### Cargoの実装

Cargoの実装は [`packages/core/src/providers/crates/`](packages/core/src/providers/crates/) にあります。`parse.ts` は位置情報を保持するMITライセンスの `toml-eslint-parser` 0.10.0 (CommonJS、Node >=16対応)を使用しています。この依存関係を変更する際は、拡張機能がサポートする最小のVS Codeバージョンを維持してください。TOML 1.0の宣言は、その最初の行または依存関係テーブルのヘッダーを注釈の位置として使用します。不正なTOMLはエントリを生成しません。Cargoのバージョン要件はnpmの範囲指定とは独立して解釈されます。保存済みのRust `semver::VersionReq` オラクルと生成された Cargo.lock フィクスチャについては [`cargo-provenance.md`](test/fixtures/lockfiles/cargo-provenance.md) で説明しています。

`workspace.ts` と `lockfile.ts` は宣言と一意に一致する公開バージョンを探すだけです。`client.ts` は送信開始のリミッター(1秒に1リクエスト)を全クライアント間で共有し、HTTP通信には `fetchJson` を使用します。`/versions` リクエストは意図的に `per_page` を省略しています。[APIの実装](https://github.com/rust-lang/crates.io/blob/main/src/controllers/krate/versions.rs)ではこのモードで全バージョンを返すためです。別ページの存在を示すレスポンスは、完了とみなさず拒否します。バージョンレコードには `license` が含まれるため、候補選定のために個々のバージョンへリクエストする必要はありません。レコードには `rust_version` も含まれ、リリースの MSRV としてライセンスの横に表示します (`>=` の範囲に正規化)。メタデータのキャッシュキーは版付き (`v2`) です。v1 のレコードにはこのフィールドが無いためです。ロックされた正確なバージョンには、ヤンクされたものも含めてバージョン別エンドポイントを使用します。一時的な失敗は `LicenseCache` に書き込まれません。HTTP 429の場合、自動リトライなしで以降の送信を少なくとも1分間遅延させます。

マニフェスト解決キーと公開バージョンのメタデータキーは分けて管理してください。前者はURI、エイリアス、セクション、ソース、要件、ワークスペースのコンテキストを含み、後者はドキュメント間で正確な公開メタデータを共有します。`invalidate()` は補助的な読み込みをクリアし、保留中のCargoリクエストをキャンセルします。Cargoコマンドの実行、アーカイブの読み込み、ソースキャッシュ、ファイルシステムウォッチャー、依存関係グラフのいずれもここには含まれません。
:::

:::kiritan{locale=en}
### MoonBit implementation

MoonBit's implementation lives in [`packages/core/src/providers/moonbit/`](packages/core/src/providers/moonbit/). moon is replacing `moon.mod.json` with `moon.mod`, a small DSL, so both are parsed: [`dsl.ts`](packages/core/src/providers/moonbit/dsl.ts) is a tokenizer for the [published grammar](https://docs.moonbitlang.com/en/latest/toolchain/moon/module.html) that reads only what is needed (the strings in a top-level `import` block, a `key = "string"`, a `key = [ … ]`) and skips whatever it does not recognize, so a half-typed statement never blanks out the dependencies above it. [`parse.ts`](packages/core/src/providers/moonbit/parse.ts) lowers both formats to the same entries, splitting each `import` item on its **last** `@` the way `read_module_from_dsl` does in moon.

A declared version is an exact `semver::Version`, never a range: moon resolves with [minimal version selection](https://github.com/moonbitlang/moon/blob/main/crates/mooncake/src/resolver/mvs.rs). Nothing here interprets ranges, and nothing runs `moon`. Resolution is [`.mooncakes`](packages/core/src/providers/moonbit/installed.ts) → `moon.work` members → the [registry index](packages/core/src/providers/moonbit/registryIndex.ts) → [mooncakes.io](packages/core/src/providers/moonbit/client.ts); the first two answer from the manifest that `moon build` unpacked, which is the only source that knows where selection actually landed, and both are checked before a declared version is even looked at — a `moon.work` member's `@version` is ignored by moon whatever it says, so validating it first would misreport a member with an odd placeholder version as unresolvable instead of skipped.

The registry index is the clone `moon update` maintains in `$MOON_HOME/registry/index` (`~/.moon` by default), one JSON-lines file per module carrying every version **and its license** — which is why an installed toolchain resolves offline. Keep dropping a malformed line on its own rather than the whole file, as the crates.io client does for a bad version record.

mooncakes.io answers `/api/v0/modules/<user>/<module>@<version>` with that release's metadata and `…/<user>/<module>` with the newest one; only the exact-version answer is cached, since the newest release is by definition what changes. That route has **no form for a nested name** such as `moonbitlang/lex/runtime`, even though the index carries one — those resolve from disk only and must not be given a hover link that would fail to load. The registry publishes no rate limit, so sends are spaced out instead of filling `maxConcurrentRequests`, and an HTTP 429 stands down for a minute without retrying.

No `moon` invocation, archive download, `.mbt` parsing, package-level (`moon.pkg`) handling or dependency graph belongs here.
:::

:::kiritan{locale=ja}
### MoonBitの実装

MoonBitの実装は [`packages/core/src/providers/moonbit/`](packages/core/src/providers/moonbit/) にあります。moonは `moon.mod.json` を小さなDSLである `moon.mod` に置き換えている途中のため、両方をパースします。[`dsl.ts`](packages/core/src/providers/moonbit/dsl.ts) は[公開されている文法](https://docs.moonbitlang.com/en/latest/toolchain/moon/module.html)に対するトークナイザーで、必要な部分(トップレベルの `import` ブロック内の文字列、`key = "string"`、`key = [ … ]`)だけを読み取り、認識できないものはすべてスキップします。そのため、途中まで書きかけの文があっても、その上に書かれた依存関係が消えることはありません。[`parse.ts`](packages/core/src/providers/moonbit/parse.ts) は両方のフォーマットを同じエントリ形式に落とし込み、各 `import` の項目をmoonの `read_module_from_dsl` と同じように**最後の** `@` で分割します。

宣言されたバージョンは正確な `semver::Version` であり、範囲指定ではありません。moonは[minimal version selection](https://github.com/moonbitlang/moon/blob/main/crates/mooncake/src/resolver/mvs.rs)で解決するためです。ここでは範囲を解釈する処理は一切なく、`moon` コマンドも実行しません。解決順序は [`.mooncakes`](packages/core/src/providers/moonbit/installed.ts) → `moon.work` メンバー → [レジストリインデックス](packages/core/src/providers/moonbit/registryIndex.ts) → [mooncakes.io](packages/core/src/providers/moonbit/client.ts) で、最初の2つは `moon build` が展開したマニフェストから答えます。これは、minimal version selectionが実際にどこに着地したかを知っている唯一の情報源です。また、この2つは宣言されたバージョンを見る**前に**チェックされます — `moon.work` メンバーの `@version` はmoonにとって何が書かれていても無視されるため、先にバージョンを検証してしまうと、奇妙なプレースホルダーのバージョンを持つメンバーが「スキップ」ではなく「解決不能」として誤って報告されてしまいます。

レジストリインデックスは、`moon update` が `$MOON_HOME/registry/index`(デフォルトは `~/.moon`)に維持しているクローンで、モジュールごとに1つのJSON Lines形式のファイルに、すべてのバージョン**とそのライセンス**が記録されています。これがインストール済みツールチェーンがオフラインで解決できる理由です。crates.ioクライアントが不正なバージョンレコードに対して行っているのと同様に、壊れた行はファイル全体を捨てるのではなく、その行だけを読み飛ばしてください。

mooncakes.ioは `/api/v0/modules/<user>/<module>@<version>` にその release のメタデータを、`…/<user>/<module>` に最新版を返します。最新版は定義上変わり得るものなので、正確なバージョンを指定した回答だけがキャッシュされます。このルートには `moonbitlang/lex/runtime` のようなネストした名前の**ルートが存在せず**、インデックス自体はそれを保持しているにもかかわらずです。そのため、そのようなモジュールはディスクからのみ解決し、読み込みに失敗するホバーリンクを渡してはいけません。レジストリはレート制限を公開していないため、`maxConcurrentRequests` を埋め尽くすのではなく送信間隔を空け、HTTP 429が返ってきた場合はリトライせずに1分間送信を停止します。

`moon` コマンドの実行、アーカイブのダウンロード、`.mbt` のパース、パッケージレベル(`moon.pkg`)の扱い、依存関係グラフのいずれもここには含まれません。
:::

:::kiritan{locale=en}
### Go implementation

Go's implementation lives in [`packages/core/src/providers/go/`](packages/core/src/providers/go/). [`parse.ts`](packages/core/src/providers/go/parse.ts) follows the lexical rules of `golang.org/x/mod/modfile` — one directive per line, `//` comments, `verb ( … )` blocks, quoted or raw strings — and reads only `require` and `replace`. `replace` is applied at parse time, an exact-version replacement winning over a wildcard one the way the go command picks; a directory target makes the requirement skipped, and a module target makes it resolve as that module.

A required version is exact: the go command uses minimal version selection, and since Go 1.17 the main module's `go.mod` lists every module the build needs at its selected version. Nothing interprets ranges, and nothing runs `go`.

Licenses come from [deps.dev](https://docs.deps.dev/api/v3/) (`GetVersion`), via [`client.ts`](packages/core/src/providers/go/client.ts): the module mirror serves no license metadata and pkg.go.dev has no API for it. Several entries in its `licenses` mean several license files in the module, so they are joined with `AND`; `non-standard` is dropped. Only found answers are cached — deps.dev may not have ingested a fresh release yet. The hover links to `https://pkg.go.dev/<module>@<version>` only after deps.dev has answered for that version, which is what shows the module is public.

[`env.ts`](packages/core/src/providers/go/env.ts) reads `GOPRIVATE`, `GONOPROXY` and `GONOSUMDB` from the process environment, then from the go env file (`$GOENV`, or `go/env` under `os.UserConfigDir()`), and matches them like `module.MatchPrefixPatterns`. A matching module is skipped before any request, so a private module's path never leaves the machine. Keep that check ahead of every network call. The one item deps.dev does not carry, a version's `go` directive, is read from that version's own `go.mod` on the module proxy; it is decoration only, and a failed read never changes the license result.

No `go` invocation, module cache or license-file reading, `go.sum`/`go.work` handling or dependency graph belongs here.
:::

:::kiritan{locale=ja}
### Goの実装

Goの実装は [`packages/core/src/providers/go/`](packages/core/src/providers/go/) にあります。[`parse.ts`](packages/core/src/providers/go/parse.ts) は `golang.org/x/mod/modfile` の字句規則(1行に1ディレクティブ、`//` コメント、`verb ( … )` ブロック、ダブルクォートとバッククォートの文字列)に従い、`require` と `replace` だけを読みます。`replace` はパースの時点で適用します。goコマンドと同じく、バージョン指定の置き換えがワイルドカードの置き換えより優先されます。置き換え先がディレクトリならその requirement はスキップし、モジュールなら置き換え先のモジュールとして解決します。

requirement のバージョンは正確なバージョンです。goコマンドはminimal version selectionを使い、Go 1.17以降はメインモジュールの `go.mod` に、ビルドに必要なすべてのモジュールが選ばれたバージョンで書かれるためです。範囲を解釈する処理はなく、`go` コマンドも実行しません。

ライセンスは [`client.ts`](packages/core/src/providers/go/client.ts) から [deps.dev](https://docs.deps.dev/api/v3/) の `GetVersion` に問い合わせて取得します。モジュールミラーはライセンスのメタデータを配信しておらず、pkg.go.devにもそのためのAPIがないためです。`licenses` に複数のエントリがあるのはモジュール内にライセンスファイルが複数あるということなので、`AND` でつなぎます。`non-standard` は捨てます。キャッシュするのは見つかった回答だけです。公開直後のリリースは、まだdeps.devに取り込まれていないことがあります。ホバーから `https://pkg.go.dev/<module>@<version>` にリンクするのは、deps.devがそのバージョンについて回答した後だけです。回答があることが、そのモジュールが公開されている証拠になります。

[`env.ts`](packages/core/src/providers/go/env.ts) は `GOPRIVATE`、`GONOPROXY`、`GONOSUMDB` をプロセスの環境変数から、次にgoのenvファイル(`$GOENV`、または `os.UserConfigDir()` 配下の `go/env`)から読み、`module.MatchPrefixPatterns` と同じ方法で照合します。一致したモジュールはリクエストの前にスキップするので、プライベートモジュールのパスがマシンの外に出ることはありません。このチェックは必ずすべてのネットワーク呼び出しより前に置いてください。deps.dev が持っていない唯一の項目である各バージョンの `go` ディレクティブは、モジュールプロキシ上のそのバージョン自身の `go.mod` から読みます。あくまで付随表示なので、読み取りの失敗でライセンス結果が変わることはありません。

`go` コマンドの実行、モジュールキャッシュやライセンスファイルの読み込み、`go.sum`/`go.work` の扱い、依存関係グラフのいずれもここには含まれません。
:::

:::kiritan{locale=en}
### Ruby implementation

Ruby's implementation lives in [`packages/core/src/providers/rubygems/`](packages/core/src/providers/rubygems/). [`parse.ts`](packages/core/src/providers/rubygems/parse.ts) tokenizes just enough Ruby for the two manifest forms — a Gemfile's `gem` calls and a gemspec's `add_dependency` family — and never executes anything. `git:`/`github:`/`path:` options and gems declared under a non-default `source` are skipped at parse time, so their names are never sent to rubygems.org. Version requirements are interpreted the way `Gem::Requirement` does, in [`spec.ts`](packages/core/src/providers/rubygems/spec.ts), independently of npm and Cargo ranges.

[`lockfile.ts`](packages/core/src/providers/rubygems/lockfile.ts) only locates declarations and uniquely matching public versions: just the `GEM` sections of Gemfile.lock whose remotes are public sources are indexed. [`client.ts`](packages/core/src/providers/rubygems/client.ts) reads `GET /api/v1/versions/<name>.json`, which carries every published version and its licenses in one response — the same shape as the crates.io client — so candidate selection needs no request per version. Platform builds of one release collapse to a single record. A gemspec's `licenses` list names every license the release is distributed under, so several entries are joined with `AND`. The same response carries each release's `ruby_version` (its `required_ruby_version`), shown next to the license the way npm shows `engines.node`; an unconstrained release reports `>= 0` and shows nothing.

No `ruby` or `bundle` invocation, installed-gem reading or dependency graph belongs here.
:::

:::kiritan{locale=ja}
### Rubyの実装

Rubyの実装は [`packages/core/src/providers/rubygems/`](packages/core/src/providers/rubygems/) にあります。[`parse.ts`](packages/core/src/providers/rubygems/parse.ts) は、2つのマニフェスト形式 — Gemfileの `gem` 呼び出しと gemspec の `add_dependency` 系 — に必要な分だけ Ruby をトークン化し、何も実行しません。`git:`/`github:`/`path:` オプションと、デフォルトでない `source` の下で宣言された gem はパースの時点でスキップするので、それらの名前が rubygems.org に送られることはありません。バージョン要件は [`spec.ts`](packages/core/src/providers/rubygems/spec.ts) で `Gem::Requirement` と同じ方法で解釈し、npm や Cargo の範囲とは独立しています。

[`lockfile.ts`](packages/core/src/providers/rubygems/lockfile.ts) は宣言の特定と、一意に一致する公開バージョンの選択だけを行います。インデックス化するのは、remote が公開ソースである Gemfile.lock の `GEM` セクションだけです。[`client.ts`](packages/core/src/providers/rubygems/client.ts) は `GET /api/v1/versions/<name>.json` を読みます。このレスポンスは公開済みの全バージョンとそのライセンスを1回で返すので (crates.io クライアントと同じ形です)、候補の選択にバージョンごとのリクエストは不要です。1つのリリースのプラットフォーム別ビルドは1レコードにまとめます。gemspec の `licenses` リストはそのリリースが配布されるすべてのライセンスを列挙したものなので、複数エントリは `AND` でつなぎます。

同じレスポンスには各リリースの `ruby_version` (`required_ruby_version`) も含まれ、npm の `engines.node` と同じ形でライセンスの横に表示します。制約なしは `>= 0` と報告されるので、その場合は何も表示しません。

`ruby` や `bundle` の実行、インストール済み gem の読み込み、依存関係グラフのいずれもここには含まれません。
:::

:::kiritan{locale=en}
### Composer implementation

Composer's implementation lives in [`packages/core/src/providers/composer/`](packages/core/src/providers/composer/). [`parse.ts`](packages/core/src/providers/composer/parse.ts) reads `require` and `require-dev` from the jsonc-parser AST, lowercases names (`composer.lock`, `installed.json` and Packagist all key packages that way) and drops platform packages (`php`, `ext-*`, `lib-*`, `composer-*-api`), which constrain PHP itself rather than a package with a license. It also picks up `config.vendor-dir`, `minimum-stability`, `prefer-stable` and whether `repositories` disables Packagist.

Resolution runs vendor → lock → registry, like npm. [`installed.ts`](packages/core/src/providers/composer/installed.ts) reads `<vendor-dir>/composer/installed.json` (the Composer 2 object or the Composer 1 array; no parent-directory walk, since Composer never hoists), [`lockfile.ts`](packages/core/src/providers/composer/lockfile.ts) reads `composer.lock`, and [`client.ts`](packages/core/src/providers/composer/client.ts) asks Packagist's p2 endpoint. Both files on disk carry each package's `license`, so a hit there is an answer, not just a pinned version. [`metadata.ts`](packages/core/src/providers/composer/metadata.ts) decodes all three sources into one `PackageRecord` and owns the rules they share: a `license` array is disjunctive by Composer's definition, so it is joined with `OR` — the opposite of deps.dev's `AND` for Go; a record's `require.php` becomes `phpVersion`; and the hover title links to Packagist only when the record's `notification-url` is Packagist's (or it came from p2), so a `path`/`vcs` package never gets a link that 404s.

A vendored or locked version is reported only if it still satisfies the manifest's constraint, so a stale lock falls through to Packagist instead of lying. A `dev-*` branch satisfies through its aliases — the constraint's own `as` clause, the record's `extra.branch-alias`, or the lock's `aliases` — which is how Composer itself lets `^1.0` be met by `dev-main`. Branches never resolve from Packagist.

[`spec.ts`](packages/core/src/providers/composer/spec.ts) is a port of `composer/semver` (`VersionParser::normalize`, `parseConstraints`, `parseStability` and PHP's `version_compare`), independent of npm and Cargo ranges, tested against TSV oracles the real library generated; [`composer-provenance.md`](test/fixtures/lockfiles/composer-provenance.md) says how to regenerate them, and the oracle wins over any prose description. Candidate selection without a lock follows Composer's stability rules: an explicit `@flag` replaces `minimum-stability` for that package, a prerelease named in the constraint lowers it, and `prefer-stable` prefers a stable candidate over a higher unstable one. p2 responses are minified — each version lists only the keys that changed, and `"__unset"` removes one — and are expanded before anything reads them; the expanded list is cached, a miss is not. Requests go out in parallel under `maxConcurrentRequests`, since p2 files are static CDN JSON, but an HTTP 429 pauses every client for a minute without retrying.

No `composer` invocation, private repository (Private Packagist, Satis, `vcs`/`path` repositories), `COMPOSER_VENDOR_DIR` handling, `replace`/`provide` resolution or dependency graph belongs here.
:::

:::kiritan{locale=ja}
### Composerの実装

Composerの実装は [`packages/core/src/providers/composer/`](packages/core/src/providers/composer/) にあります。[`parse.ts`](packages/core/src/providers/composer/parse.ts) は jsonc-parser の AST から `require` と `require-dev` を読み、名前を小文字にそろえ(`composer.lock`、`installed.json`、Packagist はいずれも小文字でパッケージを管理しています)、プラットフォームパッケージ(`php`、`ext-*`、`lib-*`、`composer-*-api`)は捨てます。これらはライセンスを持つパッケージではなく、PHP 自体への制約だからです。あわせて `config.vendor-dir`、`minimum-stability`、`prefer-stable`、`repositories` が Packagist を無効化しているかどうかも読み取ります。

解決は npm と同じく vendor → lock → レジストリの順に進みます。[`installed.ts`](packages/core/src/providers/composer/installed.ts) は `<vendor-dir>/composer/installed.json`(Composer 2 のオブジェクト形式と Composer 1 の配列形式の両方)を読みます。Composer はホイスティングをしないので、親ディレクトリは探索しません。[`lockfile.ts`](packages/core/src/providers/composer/lockfile.ts) は `composer.lock` を読み、[`client.ts`](packages/core/src/providers/composer/client.ts) は Packagist の p2 エンドポイントに問い合わせます。ディスク上の2つのファイルはどちらも各パッケージの `license` を持っているので、そこでのヒットはバージョンの固定ではなく、答えそのものです。[`metadata.ts`](packages/core/src/providers/composer/metadata.ts) は3つのソースを1つの `PackageRecord` に落とし込み、共通のルールを担います。`license` 配列は Composer の定義上「いずれかを選べる」という意味なので `OR` でつなぎます — Go の deps.dev が `AND` なのとは逆です。レコードの `require.php` は `phpVersion` になります。ホバータイトルの Packagist へのリンクは、レコードの `notification-url` が Packagist のもの(または p2 由来)であるときだけ付けるので、`path`/`vcs` 由来のパッケージが 404 になるリンクを持つことはありません。

vendor や lock のバージョンは、マニフェストの制約を今も満たしている場合にだけ報告します。そのため古くなった lock は嘘をつかず、Packagist へ落ちていきます。`dev-*` ブランチは、制約自身の `as` 句、レコードの `extra.branch-alias`、lock の `aliases` というエイリアスを通じて制約を満たせます。これは Composer 自身が `^1.0` を `dev-main` で満たせるようにしている仕組みと同じです。ブランチが Packagist から解決されることはありません。

[`spec.ts`](packages/core/src/providers/composer/spec.ts) は `composer/semver`(`VersionParser::normalize`、`parseConstraints`、`parseStability`、PHP の `version_compare`)の移植で、npm や Cargo の範囲指定とは独立しています。実際のライブラリが生成した TSV のオラクルに対してテストされており、再生成の方法は [`composer-provenance.md`](test/fixtures/lockfiles/composer-provenance.md) に書いてあります。文章での説明とオラクルが食い違うときはオラクルが正です。lock がない場合の候補選定は Composer の安定度ルールに従います。明示的な `@flag` はそのパッケージについて `minimum-stability` を置き換え、制約に書かれたプレリリースは下限を下げ、`prefer-stable` はより高い不安定版よりも安定版を優先します。p2 のレスポンスは minified 形式(各バージョンは前のバージョンから変わったキーだけを持ち、`"__unset"` はキーの削除を表す)なので、読む前に展開します。展開済みのリストはキャッシュしますが、見つからなかった結果はキャッシュしません。p2 は静的な CDN 配信の JSON なので、リクエストは `maxConcurrentRequests` の範囲で並列に送りますが、HTTP 429 が返った場合はすべてのクライアントが1分間送信を止め、リトライはしません。

`composer` コマンドの実行、プライベートリポジトリ(Private Packagist、Satis、`vcs`/`path` リポジトリ)、`COMPOSER_VENDOR_DIR` の扱い、`replace`/`provide` の解決、依存関係グラフのいずれもここには含まれません。
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

Register it in [`packages/core/src/providers/index.ts`](packages/core/src/providers/index.ts) and add the language to `activationEvents` in [`packages/vscode-extension/package.json`](packages/vscode-extension/package.json).

Also add a row to [`i18n/supported-languages.json`](i18n/supported-languages.json), which supplies the language/package-manager table in both READMEs, and remove the corresponding "planned" row if there's a tracking issue for it. Store shared cells once and use `{ "en": "…", "ja": "…" }` only for cells that differ by locale.
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

[`packages/core/src/providers/index.ts`](packages/core/src/providers/index.ts) に登録し、[`packages/vscode-extension/package.json`](packages/vscode-extension/package.json) の `activationEvents` に対象の言語を追加してください。

また、両言語のREADMEの言語/パッケージマネージャー表を生成する [`i18n/supported-languages.json`](i18n/supported-languages.json) に行を追加してください。対応するトラッキングIssueがある場合は、その「対応予定」の行を削除してください。共通のセルは一度だけ書き、言語によって異なるセルだけ `{ "en": "…", "ja": "…" }` で指定します。
:::

:::kiritan{locale=en}
### Link the hover title to the package's registry page

Every provider is expected to make the hover title clickable, the same way npm and JSR do — don't ship one that leaves it as plain text. Set one of these two `LicenseInfo` fields from `resolve()`, whichever fits the registry's URL shape:

- `registryPackageName` — when the target really is `https://www.npmjs.com/package/<name>/v/<version>` (npm and npm-compatible aliases only; nothing else should set this).
- `packagePageUrl` — the exact URL for anything else, e.g. `https://crates.io/crates/<name>/<version>` or `https://pypi.org/project/<name>/<version>/`. This is what JSR uses.

`buildHover` in [`packages/core/src/format.ts`](packages/core/src/format.ts) picks whichever is set (`registryPackageName` wins if somehow both are) and wraps it around the `` `name@version` `` title automatically — do not build that link yourself. Two things matter when you set it:

- **Resolve aliases first.** The link must point at the actual registry package, not the local manifest key — see how the npm provider follows an `npm:` alias to its real target before setting `registryPackageName` (`packages/core/src/providers/npm/index.ts`).
- **Never link something that isn't really on that registry.** A `file:`/`git`/local-path dependency, or one you're not confident about, should leave both fields unset rather than link to a URL that might 404.

If the registry also exposes a genuine, separately-declared homepage, put that in `homepage` as usual — `buildHover` already drops the `Homepage` line when it would just repeat the title link (as it does for JSR, which has no separate homepage of its own).

Python support is planned but not implemented yet — see the open issue linked from [README.md](README.md#supported-languages) for current status. These metadata endpoints may be useful:

- PyPI: `https://pypi.org/pypi/<name>/<version>/json` → `info.license` / `info.classifiers`
- [deps.dev](https://docs.deps.dev/api/v3/) answers `GetVersion` with `licenses` for PyPI too, as it does for Go
:::

:::kiritan{locale=ja}
### ホバータイトルをパッケージのレジストリページにリンクする

npmやJSRと同様に、すべてのプロバイダーはホバータイトルをクリック可能にすることが期待されています — 単なるプレーンテキストのままにしないでください。`resolve()` から、レジストリのURL形式に合う方の `LicenseInfo` フィールドを設定してください。

- `registryPackageName` — リンク先が本当に `https://www.npmjs.com/package/<name>/v/<version>` である場合(npmおよびnpm互換エイリアスのみ。それ以外はこれを設定すべきではありません)。
- `packagePageUrl` — それ以外の正確なURL。例: `https://crates.io/crates/<name>/<version>` や `https://pypi.org/project/<name>/<version>/`。JSRはこちらを使用しています。

[`packages/core/src/format.ts`](packages/core/src/format.ts) の `buildHover` はどちらか設定されている方を選び(両方設定されていれば `registryPackageName` が優先)、`` `name@version` `` というタイトルに自動的にリンクを付けます — このリンクを自分で組み立てないでください。設定する際に重要な点が2つあります。

- **エイリアスを先に解決する。** リンクはローカルのマニフェストキーではなく、実際のレジストリパッケージを指す必要があります。npmプロバイダーが `registryPackageName` を設定する前に `npm:` エイリアスを実際のターゲットまで辿っている様子を参照してください(`packages/core/src/providers/npm/index.ts`)。
- **そのレジストリに実在しないものにリンクしない。** `file:`/`git`/ローカルパスの依存関係や、確信が持てないものについては、404になり得るURLにリンクするより、両方のフィールドを未設定のままにしてください。

レジストリが本当に別途宣言されたホームページを公開している場合は、通常どおり `homepage` に設定してください — `buildHover` は、タイトルリンクと重複するだけの場合は既に `Homepage` の行を省略します(JSRのように、独自のホームページを持たない場合がそうです)。

Pythonへの対応は予定されていますが、まだ実装されていません — 現在の状況は [README.md](README.md#サポート言語) からリンクされているIssueを参照してください。以下のメタデータエンドポイントが役立つかもしれません。

- PyPI: `https://pypi.org/pypi/<name>/<version>/json` → `info.license` / `info.classifiers`
- [deps.dev](https://docs.deps.dev/api/v3/) の `GetVersion` は、Goと同じくPyPIについても `licenses` を返します
:::

:::kiritan{locale=en}
## Documentation and i18n

`README.md`, `README.ja.md`, `CONTRIBUTING.md` and `CONTRIBUTING.ja.md` are generated by [Kiritan](https://github.com/otnc/kiritan) from the base sources in [`i18n/`](i18n/) — never hand-edit a generated file, it gets silently overwritten by the next build. Edit `i18n/README.base.md` or `i18n/CONTRIBUTING.base.md` instead, then run:

```sh
npm run docs:build   # regenerate every localized document
npm run docs:check   # verify nothing is left missing/stale
```

See [AGENTS.md](AGENTS.md) and the Kiritan skill installed at [`.agents/skills/kiritan`](.agents/skills/kiritan/SKILL.md) for the full directive syntax and CLI reference.

README tables use the project-specific `::docs-table{id=...}` directive. Their shared cells and translations live together in [`i18n/supported-languages.json`](i18n/supported-languages.json), [`i18n/editors.json`](i18n/editors.json), [`i18n/commands.json`](i18n/commands.json) and [`i18n/settings.json`](i18n/settings.json). Each table's `columns` keys determine its column order; use a string for shared cells and `{ "en": "…", "ja": "…" }` for translated cells. Cells can contain Markdown links and code spans.

Command rows are keyed by command ID, and setting rows by setting ID. Their titles, setting names, default values and row order come from [`packages/vscode-extension/package.json`](packages/vscode-extension/package.json); edit the descriptions in the table files. `docs:build` fails if a command or setting has no documentation entry or an entry refers to a removed ID. The `npm.sections` row uses `defaultSummary` with `%{count}` to describe the array default without repeating its length.

The renderer in [`i18n/readme-renderer.mjs`](i18n/readme-renderer.mjs) expands table directives during parsing. Ordinary prose stays in the base files, with each English section next to its Japanese counterpart. Keep identical code examples and other shared content outside locale blocks so they only need editing once.
:::

:::kiritan{locale=ja}
## ドキュメントとi18n

`README.md`、`README.ja.md`、`CONTRIBUTING.md`、`CONTRIBUTING.ja.md` は [Kiritan](https://github.com/otnc/kiritan) によって [`i18n/`](i18n/) 内のベースソースから生成されます — 生成後のファイルを直接編集しないでください。次のビルドで黙って上書きされます。代わりに `i18n/README.base.md` や `i18n/CONTRIBUTING.base.md` を編集してから、以下を実行してください。

```sh
npm run docs:build   # ローカライズされたドキュメントをすべて再生成する
npm run docs:check   # 未翻訳・古くなった内容が残っていないか確認する
```

ディレクティブの構文やCLIリファレンスの詳細については、[AGENTS.md](AGENTS.md) と [`.agents/skills/kiritan`](.agents/skills/kiritan/SKILL.md) にインストールされているKiritanのスキルを参照してください。

READMEの表には、このプロジェクト独自の `::docs-table{id=...}` を使います。共通のセルと翻訳は [`i18n/supported-languages.json`](i18n/supported-languages.json)、[`i18n/editors.json`](i18n/editors.json)、[`i18n/commands.json`](i18n/commands.json)、[`i18n/settings.json`](i18n/settings.json) で管理します。列の順序は各ファイルの `columns` のキー順で決まります。共通のセルは文字列で、翻訳するセルは `{ "en": "…", "ja": "…" }` で書きます。セルにはMarkdownのリンクやコード表記も使えます。

コマンドの行はコマンドID、設定の行は設定IDをキーにします。コマンド名、設定名、初期値、行の順序は [`packages/vscode-extension/package.json`](packages/vscode-extension/package.json) から取得するため、表のファイルでは説明文を編集します。追加したコマンドや設定の説明がない場合や、削除したIDの説明が残っている場合は、`docs:build` がエラーになります。`npm.sections` の行は、`defaultSummary` に `%{count}` を使って配列の初期値を説明するため、要素数を書き直す必要はありません。

[`i18n/readme-renderer.mjs`](i18n/readme-renderer.mjs) のレンダラーが、解析時に表のディレクティブを展開します。通常の文章はbaseファイルで管理し、英語の節と対応する日本語の節を隣に置きます。同じコード例などの共通部分は言語別ブロックの外に置き、一度の編集で済むようにします。
:::

:::kiritan{locale=en}
## Agent skills

AI coding agents get extra instructions ("skills") from [`.agents/skills/`](.agents/skills/) via the [`skills` CLI](https://www.npmjs.com/package/skills) (`npx skills`). Only `.agents/skills/` and [`skills-lock.json`](skills-lock.json) are committed — that's the canonical copy. Every other location a given agent might look in (`.claude/skills/`, `agent/skills/`, …) is a generated symlink or copy and is gitignored; recreate them after cloning with:
:::

:::kiritan{locale=ja}
## エージェント向けスキル

AIコーディングエージェントは、[`skills` CLI](https://www.npmjs.com/package/skills)(`npx skills`)経由で [`.agents/skills/`](.agents/skills/) から追加の指示(「スキル」)を読み込みます。コミットされているのは `.agents/skills/` と [`skills-lock.json`](skills-lock.json) だけで、これが正本です。各エージェントが実際に参照する他の場所(`.claude/skills/`、`agent/skills/` など)は生成されたシンボリックリンクやコピーであり、gitignoreされています。クローン後は以下で復元してください。
:::

```sh
npx skills experimental_install
```

:::kiritan{locale=en}
To add a new skill:
:::

:::kiritan{locale=ja}
新しいスキルを追加するには:
:::

```sh
npx skills add <owner>/<repo> --agent '*' -y
```

:::kiritan{locale=en}
This clones the source, copies the canonical file into `.agents/skills/<name>/`, symlinks or copies it into whichever agent directories exist locally, and records the source and its hash in `skills-lock.json`. Only commit the `.agents/skills/` and `skills-lock.json` changes — leave the other generated agent directories untracked (see [`.gitignore`](.gitignore)).
:::

:::kiritan{locale=ja}
これによりソースがクローンされ、正本のファイルが `.agents/skills/<name>/` にコピーされ、ローカルに存在する各エージェント用ディレクトリへシンボリックリンクまたはコピーが作られ、`skills-lock.json` にソースとそのハッシュが記録されます。コミットするのは `.agents/skills/` と `skills-lock.json` の変更だけにし、その他の生成されたエージェント用ディレクトリは追跡しないままにしてください([`.gitignore`](.gitignore) を参照)。
:::

:::kiritan{locale=en}
## Development

```sh
npm install
npm run watch:vscode # esbuild in watch mode
# press F5 in VS Code to launch the Extension Development Host
```

Two launch configurations are contributed. **Run Extension** opens an empty Extension Development Host; **Run Extension (MoonBit sample)** opens [`test/fixtures/moonbit-workspace/`](test/fixtures/moonbit-workspace/) in it, which is a two-member `moon.work` holding one manifest of each format plus an unpacked `.mooncakes` module, so the annotations are visible the moment the host finishes loading. Either way, `File > Open Folder` in the host switches to a real project.

```sh
npm run format:check     # prettier --check .
npm run lint             # eslint .
npm run check-types      # tsc --noEmit
npm test                 # unit tests, against real lockfile fixtures
npm run test:integration # runs the extension inside a real VS Code
npm run package           # build a .vsix
```

The lockfiles in [`test/fixtures/lockfiles/`](test/fixtures/lockfiles/) were produced by really running `npm`, `pnpm`, `yarn` (classic and berry) and `bun` against the same manifest, so the parsers are tested against the real thing rather than hand-written samples.

`npm test` runs Vitest directly against TypeScript source — there is no compile step to run first for it. `packages/vscode-extension`'s suite additionally loads the bundled `dist/extension.js` when it exists, because bundling can break the extension on its own: a dependency whose entry point defers its `require()` calls to runtime resolves fine against source and then fails inside the extension host. Run `npm run compile` first to exercise that check instead of silently skipping it.

Cargo, MoonBit, Go and Composer each get their own integration workspace, with `Cargo.toml`, `moon.mod` and `go.mod` associated to plaintext so that dispatch cannot quietly come to depend on a language registration (`composer.json` stays JSON, which checks that the npm provider does not claim it). It checks automatic activation before opening a document or calling any extension command, then tests URI-based workspace/lockfile reads, cached metadata, Hover links, unsaved parsing and settings. Registry access is disabled in this fixture. To exercise the minimum host, set `PLV_VSCODE_VERSION=1.90.0` when running `npm run test:integration`; otherwise the current stable host is used.

Run `npm run format` before committing; CI enforces `format:check` and `lint`.
:::

:::kiritan{locale=ja}
## 開発

```sh
npm install
npm run watch:vscode # esbuildをwatchモードで実行
# VS CodeでF5を押すとExtension Development Hostが起動します
```

2つの起動構成が用意されています。**Run Extension** は空のExtension Development Hostを開きます。**Run Extension (MoonBit sample)** はその中で [`test/fixtures/moonbit-workspace/`](test/fixtures/moonbit-workspace/) を開きます。これは各フォーマットのマニフェストを1つずつと、展開済みの `.mooncakes` モジュールを持つ、2メンバー構成の `moon.work` です。そのため、ホストの起動が終わった瞬間に注釈が確認できます。どちらの場合も、ホスト内で `File > Open Folder` を実行すれば実際のプロジェクトに切り替えられます。

```sh
npm run format:check     # prettier --check .
npm run lint             # eslint .
npm run check-types      # tsc --noEmit
npm test                 # 実際のロックファイルフィクスチャに対するユニットテスト
npm run test:integration # 実際のVS Code内で拡張機能を実行するテスト
npm run package           # .vsixをビルド
```

[`test/fixtures/lockfiles/`](test/fixtures/lockfiles/) 内のロックファイルは、同じマニフェストに対して実際に `npm`、`pnpm`、`yarn`(classicとberry)、`bun` でインストールして生成したものです。そのため、パーサーは手書きのサンプルではなく実物に対してテストされています。

`npm test` はTypeScriptのソースに対して直接Vitestを実行します。事前にコンパイルする必要はありません。`packages/vscode-extension` のテストスイートは、加えてビルド済みの `dist/extension.js` が存在する場合はそれも読み込みます。バンドル自体が拡張機能を壊すことがあるためです。エントリーポイントが `require()` の呼び出しを実行時まで遅延させる依存関係は、ソースに対しては問題なく解決されても、拡張機能ホスト内では失敗することがあります。このチェックを黙ってスキップさせず実際に働かせるには、先に `npm run compile` を実行してください。

Cargo、MoonBit、Go、Composerはそれぞれ専用のIntegrationテスト用ワークスペースを持ち、`Cargo.toml`、`moon.mod`、`go.mod` はプレーンテキストに関連付けられています。これは、ディスパッチが言語登録にひそかに依存してしまうことがないようにするためです(`composer.json` はJSONのままにしてあり、npmプロバイダーに横取りされないことを確認しています)。ドキュメントを開いたり拡張機能のコマンドを呼び出したりする前の自動アクティベーションを確認したうえで、URIベースのワークスペース/ロックファイルの読み込み、キャッシュされたメタデータ、ホバーのリンク、未保存のパース、設定をテストします。このフィクスチャではレジストリへのアクセスは無効化されています。最小サポートのホストで動作確認するには、`npm run test:integration` を実行する際に `PLV_VSCODE_VERSION=1.90.0` を設定してください。指定しない場合は現在の安定版ホストが使用されます。

コミット前に `npm run format` を実行してください。CIでは `format:check` と `lint` が強制されます。
:::

:::kiritan{locale=en}
## Testing

Test code is split across two tiers — different tools on purpose, not an inconsistency:

- **Unit tests** run with Vitest, one project per package (`vitest.config.ts` at the repo root wires the two together via `test.projects`). [`packages/core/test/*.test.ts`](packages/core/test/) imports provider/cache/format source directly — no compile step, no real `vscode` at all for most of it, since these tests exercise the `ProviderHost`/`FileSystemLike`/`UriLike` abstractions through an in-memory fake host ([`test/support/fakeHost.ts`](packages/core/test/support/fakeHost.ts)) rather than any editor. The handful of `config.ts`/`log.ts`/`format.ts` calls that still touch real `vscode` APIs as values (`workspace.getConfiguration`, `window.createOutputChannel`, `MarkdownString`) go through a small stub aliased in as `"vscode"` via `vitest.config.ts`'s `resolve.alias` ([`test/support/vscodeStub.ts`](packages/core/test/support/vscodeStub.ts)). [`packages/vscode-extension/test/unit/*.test.ts`](packages/vscode-extension/test/unit/) tests `Annotator` and `extension.ts` against a fuller `vscode` stub of its own (same aliasing approach, plus `Uri`/decorations/commands/etc.) and also loads the real bundled `dist/extension.js` when it exists, through a `Module._load` patch scoped to that one test file — bundling can break the extension on its own, and that require() is the only way to exercise the actual shipped output rather than source.
- **Integration tests** ([`packages/vscode-extension/test/integration/*.test.ts`](packages/vscode-extension/test/integration/)) run inside a real VS Code via `@vscode/test-cli`. They're compiled by that package's own `tsc` pass (`npm run build-tests`) rather than run through Vitest, since Vitest cannot run inside the real extension host process.

[`test/fixtures/`](test/fixtures/) stays at the repository root, outside both packages, because it's shared data — real lockfiles and sample workspaces produced by actually running npm/pnpm/yarn/bun — not test code, and both tiers read from it.

When adding a provider or changing resolution logic, add a unit test next to the existing ones in [`packages/core/test/`](packages/core/test/), following whichever of `npm.test.ts` (npm/JSR), `crates.test.ts` (Cargo), `moonbit.test.ts` (MoonBit) or `go.test.ts` (Go), `rubygems.test.ts` (Ruby) or `composer.test.ts` (Composer) matches your ecosystem's shape. Reach for an integration test only when the behavior genuinely needs a real VS Code host (activation, `vscode.workspace.fs`, real settings) — the suites build on the fixtures under [`test/fixtures/workspace/`](test/fixtures/workspace/), [`test/fixtures/cargo-workspace/`](test/fixtures/cargo-workspace/), [`test/fixtures/moonbit-workspace/`](test/fixtures/moonbit-workspace/), [`test/fixtures/go-workspace/`](test/fixtures/go-workspace/), [`test/fixtures/ruby-workspace/`](test/fixtures/ruby-workspace/) and [`test/fixtures/composer-workspace/`](test/fixtures/composer-workspace/).
:::

:::kiritan{locale=ja}
## テスト

テストコードは2つの階層に分かれています。これはツールが違うのが意図的な設計であり、整理すべき不統一ではありません。

- **ユニットテスト**はVitestで実行され、パッケージごとに1つのプロジェクトに分かれています(リポジトリルートの `vitest.config.ts` が `test.projects` で両者をまとめています)。[`packages/core/test/*.test.ts`](packages/core/test/) はプロバイダー・キャッシュ・フォーマット関連のソースを直接importします — コンパイル不要で、実際の `vscode` もほとんど必要としません。これらのテストは特定のエディタではなく、インメモリのフェイクホスト([`test/support/fakeHost.ts`](packages/core/test/support/fakeHost.ts))を通じて `ProviderHost`/`FileSystemLike`/`UriLike` の抽象化そのものをテストしているためです。`config.ts`/`log.ts`/`format.ts` の中で依然として実際の `vscode` API を値として呼び出す一部分(`workspace.getConfiguration`、`window.createOutputChannel`、`MarkdownString`)は、`vitest.config.ts` の `resolve.alias` で `"vscode"` としてエイリアスした小さなスタブ([`test/support/vscodeStub.ts`](packages/core/test/support/vscodeStub.ts))経由で動きます。[`packages/vscode-extension/test/unit/*.test.ts`](packages/vscode-extension/test/unit/) は `Annotator` と `extension.ts` を、同じエイリアス方式によるより本格的な独自の `vscode` スタブ(`Uri`/デコレーション/コマンドなども含む)に対してテストし、加えてビルド済みの実際の `dist/extension.js` が存在する場合はそれも、そのテストファイルだけに限定した `Module._load` パッチ経由で読み込みます。バンドル自体が拡張機能を壊すことがあり、実際に出荷されるものをソースの代わりに動作確認できるのはそのrequire()だけだからです。
- **Integrationテスト**([`packages/vscode-extension/test/integration/*.test.ts`](packages/vscode-extension/test/integration/))は `@vscode/test-cli` を使って実際のVS Code内で実行します。Vitestではなく、そのパッケージ自身の `tsc` パス(`npm run build-tests`)でコンパイルされます。Vitestは実際の拡張機能ホストのプロセス内では実行できないためです。

[`test/fixtures/`](test/fixtures/) はリポジトリのルート、どちらのパッケージの外側にも置かれたままです。これは実際に npm/pnpm/yarn/bun を動かして生成したロックファイルやサンプルワークスペースといった共有データであり、テストコードではなく、両方の階層がここから読み込むためです。

プロバイダーの追加や解決ロジックの変更を行う際は、[`packages/core/test/`](packages/core/test/) 内の既存のテストの隣にユニットテストを追加してください。対象のエコシステムの形に近いもの、`npm.test.ts`(npm/JSR)、`crates.test.ts`(Cargo)、`moonbit.test.ts`(MoonBit)、`go.test.ts`(Go)、`rubygems.test.ts`(Ruby)、`composer.test.ts`(Composer)のいずれかに倣ってください。Integrationテストが必要になるのは、実際のVS Codeホスト(アクティベーション、`vscode.workspace.fs`、実際の設定)に本当に依存する挙動を検証する場合だけです。各テストスイートは [`test/fixtures/workspace/`](test/fixtures/workspace/)、[`test/fixtures/cargo-workspace/`](test/fixtures/cargo-workspace/)、[`test/fixtures/moonbit-workspace/`](test/fixtures/moonbit-workspace/)、[`test/fixtures/go-workspace/`](test/fixtures/go-workspace/)、[`test/fixtures/ruby-workspace/`](test/fixtures/ruby-workspace/)、[`test/fixtures/composer-workspace/`](test/fixtures/composer-workspace/) のフィクスチャを共通で使っています。
:::

:::kiritan{locale=en}
## Releasing

[`.github/workflows/release.yml`](.github/workflows/release.yml) is run by hand from the Actions tab. Give it a version — a bump keyword (`patch`, `minor`, `major`, `prerelease`) or an explicit version like `0.2.0` — and it does the rest:

1. type-check, unit tests, and the integration suite in a real VS Code
2. bump `package.json`, and update `CHANGELOG.md` from Conventional Commits since the last tag
3. regenerate `README.md`/`README.ja.md`/`CONTRIBUTING.md`/`CONTRIBUTING.ja.md` from `i18n/*.base.md` (`npm run docs:build`), so a release never ships with generated docs that drifted out of sync
4. build the `.vsix`
5. publish to the VS Code Marketplace
6. commit (including any documentation rebuilt in step 3), tag and push, then create the GitHub Release with the `.vsix` attached

Publishing is skipped automatically when `VSCE_PAT` is absent, so the workflow is usable before you have a token. Get one from <https://marketplace.visualstudio.com/manage> — an Azure DevOps PAT with the Marketplace → Manage scope — and add it as a repository secret.
:::

:::kiritan{locale=ja}
## リリース

[`.github/workflows/release.yml`](.github/workflows/release.yml) はActionsタブから手動で実行します。バージョン — バンプ用のキーワード(`patch`、`minor`、`major`、`prerelease`)か、`0.2.0` のような明示的なバージョン — を指定すると、残りはワークフローが行います。

1. 型チェック、ユニットテスト、実際のVS Code上でのIntegrationテストスイートを実行
2. `package.json` をバンプし、最後のタグ以降のConventional Commitsから `CHANGELOG.md` を更新
3. `i18n/*.base.md` から `README.md`/`README.ja.md`/`CONTRIBUTING.md`/`CONTRIBUTING.ja.md` を再生成(`npm run docs:build`)。これにより、生成済みドキュメントがベースソースと同期しないままリリースされることがなくなります
4. `.vsix` をビルド
5. VS Code Marketplaceに公開
6. コミット(手順3で再生成されたドキュメントも含む)、タグ付け、pushを行い、`.vsix` を添付したGitHub Releaseを作成

`VSCE_PAT` が存在しない場合は公開が自動的にスキップされるため、トークンを取得する前でもこのワークフローを使用できます。<https://marketplace.visualstudio.com/manage> から、Marketplace → Manage スコープを持つAzure DevOpsのPATを取得し、リポジトリシークレットとして追加してください。
:::

:::kiritan{locale=en}
### Changelog

`CHANGELOG.md` is generated with [git-cliff](https://git-cliff.org) (config in [`cliff.toml`](cliff.toml)) from commit messages since the last tag, grouped by [Conventional Commits](https://www.conventionalcommits.org/) type — `feat` → Added, `fix` → Fixed, `perf` → Performance, `refactor`/`revert` → Changed. Everything else (`chore`, `docs`, `test`, `style`, `ci`, `build`, `release`, merge commits) is left out, the same way it always was when this was written by hand. Write commit subjects with that in mind — they end up as changelog lines close to verbatim.

To preview what the next release's entry would look like without touching anything:
:::

:::kiritan{locale=ja}
### 変更履歴

`CHANGELOG.md` は [git-cliff](https://git-cliff.org)(設定は [`cliff.toml`](cliff.toml))を使って、最後のタグ以降のコミットメッセージから[Conventional Commits](https://www.conventionalcommits.org/)のタイプ別に生成されます — `feat` → Added、`fix` → Fixed、`perf` → Performance、`refactor`/`revert` → Changed。それ以外(`chore`、`docs`、`test`、`style`、`ci`、`build`、`release`、マージコミット)は、これまで手書きで管理していた頃と同様に除外されます。コミットの件名はそのまま変更履歴の行としてほぼそのまま使われることを意識して書いてください。

何も変更せずに次のリリースのエントリがどう見えるかをプレビューするには:
:::

```sh
npx git-cliff --unreleased --tag vX.Y.Z
```

:::kiritan{locale=en}
Tagging happens only after publishing succeeded, so a failed release leaves no dangling tag. Tick `dry_run` to rehearse the whole pipeline without publishing, committing or tagging.

To publish locally instead, copy `.env.example` to `.env`, fill in `VSCE_PAT`, and run `npm run publish` (optionally `npm run publish -- patch`).
:::

:::kiritan{locale=ja}
タグ付けは公開が成功した後にのみ行われるため、リリースが失敗してもタグが残ったままになることはありません。`dry_run` にチェックを入れると、公開・コミット・タグ付けを行わずにパイプライン全体をリハーサルできます。

ローカルから公開するには、`.env.example` を `.env` にコピーし、`VSCE_PAT` を設定した上で `npm run publish`(オプションで `npm run publish -- patch`)を実行してください。
:::
