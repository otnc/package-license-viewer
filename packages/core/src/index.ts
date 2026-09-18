/**
 * The editor-agnostic core: license resolution (`providers/`), the on-disk cache, annotation
 * formatting and a small `fetch` wrapper. None of it imports `vscode` for real — `config.ts` and
 * `log.ts` call into whatever module resolves as `"vscode"` at runtime, which is a real
 * `vscode` module in the extension host and a small shim (`packages/lsp-server/src/vscodeShim.ts`)
 * everywhere else. See `docs/vim-neovim-lsp-design.md` in the repository root.
 */
export * from "./providers";
export { CancellationTokenSource } from "./providers/cancellation";
export { LicenseCache } from "./cache";
export {
  CONFIG_SECTION,
  getConfig,
  getSetting,
  invalidateConfigCache,
  type ViewerConfig,
} from "./config";
export {
  buildHover,
  formatAnnotation,
  formatAnnotationSegments,
  type AnnotationSegments,
} from "./format";
export { initLog, log } from "./log";
export { NotFoundError, fetchJson, runWithConcurrency } from "./net";
