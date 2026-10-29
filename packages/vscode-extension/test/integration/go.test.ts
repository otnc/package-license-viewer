import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  GoLicenseProvider,
  LicenseCache,
  buildHover,
  createProviders,
  findProvider,
} from "@plv/core";
import { toTextDocumentLike } from "../../src/annotator";
import { vscodeProviderHost } from "../../src/vscodeFs";

const noCancel = new vscode.CancellationTokenSource().token;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function uri(...parts: string[]): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  return vscode.Uri.joinPath(folder.uri, ...parts);
}
function memoryCache(): LicenseCache {
  return new LicenseCache({
    keys: () => [],
    get: <T>(_key: string, fallback?: T) => fallback,
    update: async () => {},
  });
}

suite("Go workspace", () => {
  test("activates automatically on a workspace holding a go.mod", async () => {
    const extension = vscode.extensions.getExtension("otoneko1102.package-license-viewer");
    assert.ok(extension);
    const deadline = Date.now() + 20_000;
    while (!extension.isActive && Date.now() < deadline) await delay(50);
    assert.equal(
      extension.isActive,
      true,
      "workspaceContains:**/go.mod must activate the production bundle on its own"
    );
  });

  test("dispatches a plaintext go.mod and resolves it without touching deps.dev", async () => {
    const cache = memoryCache();
    try {
      assert.equal(
        vscode.workspace.getConfiguration("packageLicenseViewer").get("go.useRegistry"),
        false
      );
      const document = await vscode.workspace.openTextDocument(uri("app", "go.mod"));
      // Without the Go extension go.mod has no language of its own, so dispatch cannot depend on one
      assert.equal(document.languageId, "plaintext");
      const doc = toTextDocumentLike(document);
      const provider = findProvider(createProviders(cache, vscodeProviderHost), doc);
      assert.ok(provider instanceof GoLicenseProvider);

      const entries = provider.parse(doc);
      assert.deepEqual(
        entries.map((entry) => [entry.name, entry.line]),
        [
          ["github.com/gorilla/mux", 4],
          ["golang.org/x/text", 7],
          ["example.com/forked", 8],
          ["example.com/vendored", 9],
        ]
      );

      // Cached metadata still answers while requests are turned off
      cache.set("go:depsdev:v1:github.com/BurntSushi/toml@v1.3.2", {
        licenses: ["MIT"],
        sourceRepo: "https://github.com/BurntSushi/toml",
      });
      const forked = await provider.resolve(entries[2], doc, noCancel);
      assert.equal(forked.license, "MIT");
      assert.equal(forked.version, "v1.3.2");
      assert.match(
        buildHover(entries[2], forked)?.value ?? "",
        /https:\/\/pkg\.go\.dev\/github\.com\/BurntSushi\/toml@v1\.3\.2/
      );

      const offline = await provider.resolve(entries[0], doc, noCancel);
      assert.equal(offline.source, "unknown");
      assert.equal(offline.detail, "deps.dev lookups are disabled");

      assert.deepEqual(await provider.resolve(entries[3], doc, noCancel), {
        source: "skipped",
        detail: "replaced with a local directory",
      });

      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand("packageLicenseViewer.refresh");
    } finally {
      cache.dispose();
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    }
  });
});
