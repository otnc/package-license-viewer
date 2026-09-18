# Vim / Neovim support and a shared language server

Status: draft / work in progress. This document lays out the plan for adding Vim and Neovim support alongside the existing VS Code extension, without duplicating the license-resolution logic that already exists for npm, JSR and Cargo.

## Goals

- Show the same inline license annotations and hover information in Vim and Neovim.
- Write the plugin itself in VimScript so it runs on plain Vim, and add Neovim-only enhancements in Lua where Vim has no equivalent (see "Editor capability differences" below).
- Extract a language server so the resolution logic (providers, cache, formatting) is shared between VS Code and Vim/Neovim instead of being reimplemented per editor.
- Keep the current `LicenseProvider` extension point (see [CONTRIBUTING.md](../CONTRIBUTING.md#adding-another-ecosystem)) as the single place a new ecosystem (PyPI, Go, …) is added, regardless of which editor is asking.

## Proposed layout

Move to a small monorepo. Nothing here changes behavior for existing VS Code users; it is a mechanical split of the current `src/` tree.

```
packages/
  core/              # editor-agnostic: providers, cache, format, net (current src/ minus vscode APIs)
  vscode-extension/  # current extension: annotator.ts, extension.ts, package.json, vsix packaging
  lsp-server/        # Node LSP server built on `core`, spawned by the Vim/Neovim plugin
  vim-plugin/         # VimScript plugin (`plugin/`, `autoload/`) + `lua/` for Neovim-only extras
```

`packages/core` is what makes the sharing real: `providers/*`, `cache.ts`, `format.ts`, `net.ts` do not need `vscode` today except at the type level (`vscode.TextDocument`, `vscode.CancellationToken` in `LicenseProvider`). Replacing those with small local interfaces —

```ts
interface TextDocumentLike {
  readonly uri: string;
  getText(): string;
  lineAt(line: number): { text: string };
  readonly lineCount: number;
}
interface CancellationLike {
  readonly isCancellationRequested: boolean;
}
```

— lets `LicenseProvider`, `createProviders`, `findProvider` and every existing provider move into `packages/core` completely unchanged in behavior. The VS Code extension adapts its real `vscode.TextDocument` to `TextDocumentLike` (it already satisfies the shape structurally) and keeps `annotator.ts` (decorations, debouncing, hover rendering) as VS Code-specific, since that part is inherently about VS Code's decoration API.

## LSP server (`packages/lsp-server`)

A standard `vscode-languageserver` (Node) server wrapping `packages/core`:

- `textDocument/didOpen` / `didChange` → parse with the matching provider, resolve entries, cache results (reusing `cache.ts` and `net.ts` as-is).
- Annotations are not something standard LSP has a matching concept for (inlay hints are single-color and are not really meant for this); expose them as a **custom notification** (`packageLicenseViewer/annotations`, `{ uri, entries: { line, segments, hoverMarkdown }[] }`) that any client can subscribe to and render however fits the host editor. VS Code can optionally move to this later; Vim/Neovim depend on it from the start.
- `textDocument/hover` → reuse `buildHover` from `format.ts` as-is.
- Server-side settings mirror the existing `packageLicenseViewer.*` configuration keys, sent once via `workspace/didChangeConfiguration`.

This keeps the exact resolution behavior (three-step npm lookup, Cargo's registry/lockfile logic, JSR routing) identical across editors, since it is the same `core` code running underneath.

## Vim / Neovim plugin (`packages/vim-plugin`)

### Editor capability differences

| Need | Vim | Neovim |
| --- | --- | --- |
| Start/talk to a job (the LSP server) | `job_start()` + `ch_sendraw()` (Vim 8.1+) | `vim.lsp.start()` (built-in LSP client) or `jobstart()` |
| Colored virtual text after a line | `prop_type_add()` + `prop_add()` with `text_align: 'after'` (Vim 9.0+) — one color per prop type, so still workable for the license segment | `nvim_buf_set_extmark()` with `virt_text` — supports multiple highlighted chunks per mark directly |
| Hover popup | `popup_atcursor()` | `vim.lsp.buf.hover()` / a floating window |

VimScript is the base implementation because it is the only language that runs on both. It implements: a minimal JSON-RPC client over the LSP server's stdio job, the custom-notification handler, and rendering with `prop_add`/`popup_atcursor`. This alone gives full functionality on plain Vim 9+.

Neovim gets an optional `lua/` layer, loaded only `if has('nvim')`, that replaces the rendering/transport pieces with `vim.lsp.start()` and `nvim_buf_set_extmark()` where they do strictly more than the VimScript path (multi-color virtual text in one mark, no manual JSON-RPC framing). The VimScript autoload functions stay the single source of truth for anything Vim can already do — Lua is additive, not a parallel reimplementation.

### Structure

```
packages/vim-plugin/
  plugin/package_license_viewer.vim   # commands, autocmds, entry point
  autoload/package_license_viewer.vim # LSP client, rendering, config (Vim-compatible)
  lua/package_license_viewer/init.lua # Neovim-only transport/rendering overrides
  doc/package_license_viewer.txt      # :help file
```

## Extensibility for future languages

No change to the extension point itself: a new ecosystem is still "implement `LicenseProvider`, add it to `createProviders()`" (see [CONTRIBUTING.md](../CONTRIBUTING.md#adding-another-ecosystem)), done once in `packages/core`. Because every editor front end (VS Code annotator, LSP server) consumes the same `createProviders()` output, a provider added for PyPI or Go automatically works in VS Code, Vim and Neovim without any editor-specific code.

## Milestones

- [x] Editor-agnostic interfaces (`TextDocumentLike`, `CancellationLike`, `UriLike`, `FileSystemLike`, `ProviderHost`) — `src/providers/` has no `vscode` import left at all; VS Code extension keeps working unchanged on top of it
- [x] `src/lspServer/`: wraps the same providers, `packageLicenseViewer/annotations` notification, hover — still living under `src/` rather than a separate `packages/core`/`packages/lsp-server` split (see "Not done yet" below)
- [x] `packages/vim-plugin`: VimScript LSP client + `prop_add` rendering, verified against a real `dist/lspServer.js` on Vim 9.2 (job/channel/textprop)
- [x] `packages/vim-plugin/lua`: Neovim transport/rendering overrides (`vim.lsp.start()` + `nvim_buf_set_extmark()`), verified on Neovim 0.12
- [x] Docs: `:help` file for the Vim/Neovim plugin (`packages/vim-plugin/doc/package_license_viewer.txt`)
- [x] README section pointing at the Vim/Neovim plugin (the Editors table)
- [x] Settings sync (`g:package_license_viewer_settings` / Neovim's `vim.lsp.start({ settings = ... })`, flattened server-side into the same `packageLicenseViewer.<key>` shape `vscode.workspace.getConfiguration` reads) — still no debounce/cancellation of in-flight resolutions on rapid edits on the plain Vim side
- [ ] Bundle `dist/lspServer.js` with the plugin (or document a build step) instead of requiring `npm run compile:lsp` from the repository root
- [ ] CI: lint/test the new packages; package the Vim plugin for `vim-plug`/`packer`/`lazy.nvim`
- [ ] Physical `packages/core`/`packages/lsp-server` npm-workspaces split — deferred; touches CI/release.yml/vsce packaging on the live Marketplace extension
