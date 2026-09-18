import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

const dir = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// "vscode" only exists inside the real extension host, so it's aliased to a local stub instead of
// the usual node_modules resolution; "@plv/core" is aliased straight to its TypeScript source
// (bypassing the package's own "main", which points at compiled output for esbuild's sake) so
// running these tests never depends on a prior `npm run compile` in either package.
export default defineProject({
  test: {
    name: "vscode-extension",
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
  },
  resolve: {
    alias: {
      vscode: dir("./test/support/vscodeStub.ts"),
      "@plv/core": dir("../core/src/index.ts"),
    },
  },
});
