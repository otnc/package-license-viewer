import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  RubyGemsLicenseProvider,
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

suite("Ruby workspace", () => {
  test("activates automatically on a workspace holding a Gemfile", async () => {
    const extension = vscode.extensions.getExtension("otoneko1102.package-license-viewer");
    assert.ok(extension);
    const deadline = Date.now() + 20_000;
    while (!extension.isActive && Date.now() < deadline) await delay(50);
    assert.equal(
      extension.isActive,
      true,
      "workspaceContains:**/Gemfile must activate the production bundle on its own"
    );
  });

  test("dispatches a plaintext Gemfile and resolves it without touching rubygems.org", async () => {
    const cache = memoryCache();
    try {
      assert.equal(
        vscode.workspace.getConfiguration("packageLicenseViewer").get("rubygems.useRegistry"),
        false
      );
      const document = await vscode.workspace.openTextDocument(uri("app", "Gemfile"));
      // The fixture associates Gemfile with plaintext, so dispatch cannot depend on a Ruby language registration
      assert.equal(document.languageId, "plaintext");
      const doc = toTextDocumentLike(document);
      const provider = findProvider(createProviders(cache, vscodeProviderHost), doc);
      assert.ok(provider instanceof RubyGemsLicenseProvider);

      const entries = provider.parse(doc);
      assert.deepEqual(
        entries.map((entry) => [entry.name, entry.line]),
        [
          ["rails", 4],
          ["forked", 5],
          ["vendored", 6],
          ["internal", 9],
        ]
      );

      // Cached metadata still answers while requests are turned off
      cache.set("rubygems:versions:v1:forked", [
        { version: "1.0.0", licenses: ["MIT"], prerelease: false, platform: "ruby" },
      ]);
      const forked = await provider.resolve(entries[1], doc, noCancel);
      assert.equal(forked.license, "MIT");
      assert.equal(forked.version, "1.0.0");
      assert.match(
        buildHover(entries[1], forked)?.value ?? "",
        /https:\/\/rubygems\.org\/gems\/forked\/versions\/1\.0\.0/
      );

      const offline = await provider.resolve(entries[0], doc, noCancel);
      assert.equal(offline.source, "unknown");
      assert.equal(offline.detail, "registry disabled and no cached public versions");

      assert.deepEqual(await provider.resolve(entries[2], doc, noCancel), {
        source: "skipped",
        detail: "git and path gems are not published to RubyGems",
      });
      assert.deepEqual(await provider.resolve(entries[3], doc, noCancel), {
        source: "skipped",
        detail: "declared with a non-default source",
      });

      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand("packageLicenseViewer.refresh");
    } finally {
      cache.dispose();
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    }
  });
});
