import { defineConfig } from "@vscode/test-cli";

// Runs the integration suite inside a real VS Code instance, so the code is exercised against the actual vscode API rather than the stub the unit tests use.
export default defineConfig([
  {
    label: "existing providers",
    version: process.env.PLV_VSCODE_VERSION,
    files: "out/test/integration/extension.test.js",
    workspaceFolder: "./test/fixtures/workspace",
    mocha: {
      // tdd is what gives us suite() / test()
      ui: "tdd",
      timeout: 30_000,
    },
  },
  {
    label: "Cargo workspace activation",
    version: process.env.PLV_VSCODE_VERSION,
    files: "out/test/integration/cargo.test.js",
    workspaceFolder: "./test/fixtures/cargo-workspace",
    launchArgs: ["--disable-extensions"],
    mocha: { ui: "tdd", timeout: 30_000 },
  },
  {
    label: "MoonBit workspace activation",
    version: process.env.PLV_VSCODE_VERSION,
    files: "out/test/integration/moonbit.test.js",
    workspaceFolder: "./test/fixtures/moonbit-workspace",
    launchArgs: ["--disable-extensions"],
    mocha: { ui: "tdd", timeout: 30_000 },
  },
  {
    label: "Cargo language activation",
    version: process.env.PLV_VSCODE_VERSION,
    files: "out/test/integration/cargo-language.test.js",
    extensionDevelopmentPath: [".", "./test/fixtures/toml-language"],
    launchArgs: [
      "--disable-extensions",
      "--new-window",
      "--user-data-dir=./.vscode-test/cargo-language-user-data",
    ],
    mocha: { ui: "tdd", timeout: 30_000 },
  },
]);
