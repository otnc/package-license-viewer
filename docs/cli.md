# Package License Viewer CLI

The `plv` CLI resolves dependency licenses from a manifest and can enforce a license policy in CI or an editor. It supports the same manifests and resolution rules as the extension. Use Node.js 22 or newer.

## Build and run

From the repository root, run:

```sh
npm ci
npm run compile:cli
node packages/cli/dist/plv.js path/to/package.json
```

Add `--format json` for structured output, including the declared dependency, resolved version and license source when available. Text output uses `path:line:column: severity: message` with one-based positions. Providers report the declaration line, so the column is always 1.

## License policy

```sh
node packages/cli/dist/plv.js --allow MIT --allow Apache-2.0 path/to/package.json
node packages/cli/dist/plv.js --deny GPL-3.0-only path/to/Cargo.toml
```

Repeat `--allow` or `--deny` for each accepted or blocked expression. Values match the complete, case-sensitive license expression. Quote compound expressions such as `"MIT OR Apache-2.0"` when you want to match them. A deny match takes precedence. Dependencies with an unknown license produce warnings when a policy is active. Dependencies deliberately skipped by a provider, such as Git dependencies, are omitted.

Exit status is 0 for successful reporting or a policy with no findings, 1 for policy warnings and 2 for a command or input error. The CLI uses the providers' manifest parsers, which may return zero dependencies for malformed input. Run your manifest syntax checker separately in CI.

The CLI stores registry results per manifest in the user cache directory under `package-license-viewer/cli`. Results expire after 168 hours by default. Override that with `--cache-ttl-hours` and set it to `0` to disable caching.

## efm-langserver

Add a tool like this to your [efm-langserver configuration](https://github.com/mattn/efm-langserver/blob/master/schema.md). Replace the bundle path and license policy with your own. The example applies the policy to JSON and JSONC manifests.

```yaml
version: 2
tools:
  plv: &plv
    lint-command: 'node "/absolute/path/to/package-license-viewer/packages/cli/dist/plv.js" --stdin --ignore-unsupported --allow MIT --allow Apache-2.0 -- "${INPUT}"'
    lint-stdin: true
    lint-ignore-exit-code: true
    lint-source: plv
    lint-formats:
      - "%W%f:%l:%c: warning: %m"
languages:
  json:
    - <<: *plv
  jsonc:
    - <<: *plv
```

The buffer comes from stdin. The manifest path lets the providers locate neighboring lockfiles and installed dependencies, including when the buffer has unsaved edits.

On Windows, efm-langserver 0.0.57 passes the command through `cmd.exe`. Use paths without spaces and omit the double quotes around the bundle path and `${INPUT}` in `lint-command`.
