import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  ComposerLicenseProvider,
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

suite("Composer workspace", () => {
  test("activates automatically on a workspace holding a composer.json", async () => {
    const extension = vscode.extensions.getExtension("otoneko1102.package-license-viewer");
    assert.ok(extension);
    const deadline = Date.now() + 20_000;
    while (!extension.isActive && Date.now() < deadline) await delay(50);
    assert.equal(
      extension.isActive,
      true,
      "workspaceContains:**/composer.json must activate the production bundle on its own"
    );
  });

  test("dispatches composer.json and resolves it from vendor/ and composer.lock without touching Packagist", async () => {
    const cache = memoryCache();
    try {
      assert.equal(
        vscode.workspace.getConfiguration("packageLicenseViewer").get("composer.useRegistry"),
        false
      );
      const document = await vscode.workspace.openTextDocument(uri("app", "composer.json"));
      assert.equal(document.languageId, "json");
      const doc = toTextDocumentLike(document);
      const provider = findProvider(createProviders(cache, vscodeProviderHost), doc);
      assert.ok(
        provider instanceof ComposerLicenseProvider,
        "composer.json must not be taken by the npm provider"
      );

      const entries = provider.parse(doc);
      // php and ext-json are platform packages and produce no entry
      assert.deepEqual(
        entries.map((entry) => [entry.name, entry.section, entry.line]),
        [
          ["psr/log", "require", 5],
          ["acme/missing", "require", 6],
          ["psr/container", "require-dev", 9],
        ]
      );

      // Installed under vendor/: read through vscode.workspace.fs
      const installed = await provider.resolve(entries[0], doc, noCancel);
      assert.equal(installed.source, "local");
      assert.equal(installed.license, "MIT");
      assert.equal(installed.version, "3.0.2");
      assert.equal(installed.phpVersion, ">=8.0.0");
      assert.match(
        buildHover(entries[0], installed)?.value ?? "",
        /https:\/\/packagist\.org\/packages\/psr\/log#3\.0\.2/
      );

      // Only in composer.lock (installed with --no-dev)
      const locked = await provider.resolve(entries[2], doc, noCancel);
      assert.equal(locked.source, "lockfile");
      assert.equal(locked.via, "`composer.lock`");
      assert.equal(locked.license, "MIT");

      // Neither installed nor locked, and requests are turned off
      const offline = await provider.resolve(entries[1], doc, noCancel);
      assert.deepEqual(offline, { source: "unknown", detail: "Packagist lookups are disabled" });

      // Cached metadata still answers while requests are turned off
      cache.set("composer:packagist:v2:acme/missing", [
        {
          name: "acme/missing",
          version: "1.4.0",
          versionNormalized: "1.4.0.0",
          license: "BSD-3-Clause",
          branchAliases: {},
          fromPackagist: true,
        },
      ]);
      const cached = await provider.resolve(entries[1], doc, noCancel);
      assert.equal(cached.source, "registry");
      assert.equal(cached.license, "BSD-3-Clause");
      assert.equal(cached.version, "1.4.0");

      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand("packageLicenseViewer.refresh");
    } finally {
      cache.dispose();
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    }
  });
});
