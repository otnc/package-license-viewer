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

## Everything else

The architecture, how to add a new ecosystem (`LicenseProvider`), local development and release process are documented in [CONTRIBUTING.md](CONTRIBUTING.md) — read the base source at [`i18n/CONTRIBUTING.base.md`](i18n/CONTRIBUTING.base.md) if you intend to change it.
