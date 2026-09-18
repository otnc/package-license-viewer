# Agent instructions

This file is for AI coding agents (Claude Code, Codex, Cursor, etc.) working in this repository. It's plain Markdown with no agent-specific syntax, so it applies equally regardless of which agent is reading it. For human-facing project docs, see [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation is generated — never hand-edit it

`README.md`, `README.ja.md`, `CONTRIBUTING.md` and `CONTRIBUTING.ja.md` are built from base sources in [`i18n/`](i18n/) with [Kiritan](https://github.com/otnc/kiritan) (`i18n/README.base.md`, `i18n/CONTRIBUTING.base.md`). Editing a generated file directly gets silently overwritten by the next build and will make `kiritan check` report it as stale.

Always edit the `*.base.md` file in `i18n/` instead, then regenerate:

```sh
npm run docs:build   # regenerate every localized document
npm run docs:check   # verify nothing is left missing/stale
```

A skill with the full Kiritan operating manual (directive syntax, CLI commands, common mistakes) is installed at [`.agents/skills/kiritan`](.agents/skills/kiritan/SKILL.md) — load it before editing anything under `i18n/`.

## Read CONTRIBUTING.md before changing code

[CONTRIBUTING.md](CONTRIBUTING.md) is the source of truth for how this project is worked on — read it before making a code change, not just when something breaks. It covers the architecture, how to add a new ecosystem (`LicenseProvider`), which of the two test tiers a change belongs in (unit tests in `test/*.test.js` vs. integration tests in `src/test/integration/*.test.ts` — see its "Testing" section), commit message conventions (English or Japanese, Conventional Commits type prefix), local development and the release process. Read the base source at [`i18n/CONTRIBUTING.base.md`](i18n/CONTRIBUTING.base.md) if you intend to change any of it.
