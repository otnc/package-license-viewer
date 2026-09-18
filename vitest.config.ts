import { defineConfig } from "vitest/config";

// packages/lsp-server has no unit tests of its own (it's a thin wrapper over @plv/core,
// exercised indirectly through packages/core's tests), so it's left out here on purpose.
export default defineConfig({
  test: {
    projects: ["packages/core", "packages/vscode-extension"],
  },
});
