import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

const dir = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// "vscode" is aliased to a local stub (see test/support/vscodeStub.ts) since config.ts, log.ts
// and format.ts still call a few real vscode APIs as values (workspace.getConfiguration,
// window.createOutputChannel, MarkdownString) — everything else in this package already avoids
// vscode entirely via TextDocumentLike/FileSystemLike/UriLike/ProviderHost.
export default defineProject({
  test: {
    name: "core",
    include: ["test/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
    setupFiles: ["./test/setup.ts"],
  },
  resolve: {
    alias: {
      vscode: dir("./test/support/vscodeStub.ts"),
    },
  },
});
