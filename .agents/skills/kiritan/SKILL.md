---
name: kiritan
description: Helps write and maintain Kiritan-based i18n — editing base/*.base.md files with :::kiritan{...} directives, choosing the sidecar/inline/catalog document strategy or the colocated/split/centralized/embedded runtime strategy, running kiritan build/check/translate/extract/typegen, and avoiding common mistakes such as hand-editing generated output. Use when a repo has a *.kiritanconfig config file, a base/ directory of *.base.md sources, or generated docs carrying a `<!-- kiritan:untranslated -->` / `<!-- kiritan:hash ... -->` marker — or when asked to localize a README/doc, add or fix a translation, or resolve a `kiritan check` failure.
metadata:
  trigger: kiritan i18n documentation and runtime resource work
  language: en, ja
---

# kiritan

Kiritan is an i18n tool that, beyond the usual key→string runtime i18n, also builds localized documents (README, docs, etc.) from a single base file. This is the operating manual for working inside a project that already uses it — not for writing Kiritan's own source. It's plain Markdown with no Claude-specific instructions in the body, so any coding agent that can be given extra context works equally well; see [../README.md](../README.md) for how to load it into whichever agent you're using.

## Recognizing a Kiritan project

Look for any of:
- A `.kiritanconfig` (or `dev.kiritanconfig`/`local.kiritanconfig`/etc.) config file, usually at the repo root, exporting `defineConfig({...})`. It has no file extension by design — don't mistake it for a stray/misnamed file.
- A `base/` directory containing `*.base.md` files (the convention this project itself uses; a project may instead keep base files elsewhere per its own `sources` globs).
- A generated document carrying a `<!-- kiritan:untranslated (source: ...) -->` or `<!-- kiritan:hash ... -->` HTML comment, or an auto-inserted language-switcher line (`**English** | [日本語](...)`).

## The one rule that matters most: never hand-edit generated output

Every file listed under the resolved config's `sources` (check `.kiritanconfig` and its `naming`/`naming.template` for the actual output paths) is **generated** from a base file — editing it directly gets silently overwritten on the next `kiritan build`, and for `sidecar`/`catalog` strategies it will drift from its embedded hash, which `kiritan check` reports as `stale`.

Always find and edit the `*.base.md` source instead, then regenerate:

```sh
kiritan build         # or: npm run docs:build, if the project defines that script
kiritan check         # verify nothing is left missing/stale before finishing
```

If you can't find the base file, read the config's `sources` globs and `naming.baseSuffix` (default `".base"`) to work out which file is the real source for a given output.

## Directive syntax (`inline` strategy)

remark-directive syntax, one locale per self-contained block — never a single block trying to hold a switch/case over multiple locales:

```md
:::kiritan{locale=en}
## Usage
English content.
:::

:::kiritan{locale=ja}
## 使い方
日本語のコンテンツ。
:::
```

- Content **outside** any `:::kiritan{...}` block is shared verbatim across every locale's output (badges, license notices, etc.).
- `locale=xx` must exactly match a value in the resolved config's `locales.list` — an unrecognized code is a **build-time error**, not a silent skip.
- `::kiritan{switcher}` (a leaf directive, no closing `:::`) marks where the language-switcher line is inserted. It's usually unnecessary to add by hand — Kiritan auto-inserts it after the first heading unless a marker already exists or `switcher.position`/`switcher.enabled` says otherwise.
- Nesting another directive inside a block just needs more colons on the outer fence (`::::kiritan{locale=en}` wrapping a `:::note`) — no special handling needed.

## Directive syntax (`catalog` strategy)

```md
:::kiritan{#usage-intro}
## Usage
This is the base-locale original text.
:::
```

- The id is author-assigned and stable — never auto-derived from position or content hash. Reuse the same id when rewording the surrounding prose; only change it if the segment's meaning truly changed.
- Translations live in a sibling `<base>.<locale>.catalog.json`, keyed by id: `{ "usage-intro": { "text": "...", "machine": true, "hash": "..." } }`. Don't hand-write the `hash` field — it's maintained by `kiritan extract`/`translate`.
- After adding a new `:::kiritan{#<id>}` block, run `kiritan extract` to scaffold its empty catalog entry before it can be translated.

## `sidecar` strategy

A whole separate file per locale (`README.ja.md` next to `README.base.md`), translated by hand or via `kiritan translate` (only if the source configures `translate.middlewares`). A `<!-- kiritan:hash ... -->` comment near the top records the base content's hash at translation time; don't remove or hand-edit it, or `kiritan check` loses the ability to detect that file going stale.

## Variable interpolation

Use `%{name}`, not `{{name}}` — Kiritan follows the Ruby/Rails-style convention to avoid colliding with Handlebars/Mustache/i18next. Escape a literal with `\%{name}`. Values come only from the config's `interpolation.variables`, never from translation content.

## CLI commands, and when to reach for each

| Command | Run it when |
| --- | --- |
| `kiritan build` | After editing any `*.base.md` — regenerates every configured output. |
| `kiritan check` | After any base-file or translation change, before calling the work done — CI-friendly, reports `missing`/`stale`/`machine`/`i18n-key-mismatch`. |
| `kiritan extract` | After adding a new `:::kiritan{#<id>}` block, for `catalog`-strategy sources — scaffolds the new id into each locale's catalog file. |
| `kiritan translate` | To auto-fill missing/stale translations — only does anything if the source configures `translate.middlewares`; the default is an empty array (no-op). |
| `kiritan typegen` | Only for runtime i18n, when `runtime.sources` aggregates multiple files into one shared `t()` — regenerates the aggregated type declaration. |

All accept `--mode <mode>` and `--config <path>` to layer on non-default config files.

## Runtime i18n (`t(key, params)`), not documents

Separate from document translation — for UI strings in application code, via `@kiritan/runtime`'s `createT()`. Every placement strategy normalizes to the same `ResourceModule` shape (`key → { locale: value }`), so pick whichever fits the existing codebase:

- **`colocated`** (default/simplest): one file per component holding every locale — `Button.i18n.ts` exporting `{ submit: { en: "Submit", ja: "送信" } }`.
- **`split`**: same idea, one file per locale — `Button.en.i18n.ts` / `Button.ja.i18n.ts`.
- **`centralized`**: i18next-compatible — `locales/{locale}/{namespace}.json`.
- **`embedded`**: exported directly from the component's own source file (`export const i18n = {...}` inside `Button.tsx`).

Check the project's `runtime.sources` config before assuming which one is in use — don't introduce a second strategy alongside an existing one without a reason.

## Common mistakes to avoid

- Editing a generated output file instead of its `*.base.md` source (see the rule above).
- Writing `{{name}}` instead of `%{name}` for interpolation.
- Packing multiple locales into one `:::kiritan{...}` block instead of one self-contained block per locale.
- Using a `locale=` value not present in `locales.list` (build-time error).
- Adding a new `:::kiritan{#<id>}` block for `catalog` and forgetting to run `kiritan extract` before it can be translated.
- Hand-writing or guessing a catalog entry's `hash` field.
- Assuming `kiritan translate` does something when the source has no `translate.middlewares` configured — check the config first.

## Minimal working config, for reference

```js
// .kiritanconfig
import { defineConfig } from "kiritan";

export default defineConfig({
  locales: { default: "en", list: ["en", "ja"] },
  sources: [{ glob: "base/README.base.md", strategy: "inline" }],
});
```

## Where to look for more

- The target project's own `docs/DESIGN.md`, if it has one — the authoritative spec for its config shape and behavior (Kiritan's own repository ships one).
- `kiritan <command> --help` for exact flags.
