# Package License Viewer

**English** | [日本語](README.ja.md)

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
