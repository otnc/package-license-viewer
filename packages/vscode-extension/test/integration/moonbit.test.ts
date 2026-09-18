import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  LicenseCache,
  MoonbitLicenseProvider,
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

suite("MoonBit workspace", () => {
  test("activates automatically on a workspace holding a moon.mod", async () => {
    const extension = vscode.extensions.getExtension("otoneko1102.package-license-viewer");
    assert.ok(extension);
    const deadline = Date.now() + 20_000;
    while (!extension.isActive && Date.now() < deadline) await delay(50);
    assert.equal(
      extension.isActive,
      true,
      "workspaceContains:**/moon.mod must activate the production bundle on its own"
    );
  });

  test("dispatches a plaintext moon.mod and resolves it without touching mooncakes.io", async () => {
    const cache = memoryCache();
    try {
      assert.equal(
        vscode.workspace.getConfiguration("packageLicenseViewer").get("moonbit.useRegistry"),
        false
      );
      const document = await vscode.workspace.openTextDocument(uri("app", "moon.mod"));
      // The DSL has no language of its own here, so dispatch cannot depend on one
      assert.equal(document.languageId, "plaintext");
      const providers = createProviders(cache, vscodeProviderHost);
      const doc = toTextDocumentLike(document);
      const provider = findProvider(providers, doc);
      assert.ok(provider instanceof MoonbitLicenseProvider);

      const entries = provider.parse(doc);
      assert.deepEqual(
        entries.map((entry) => [entry.name, entry.line]),
        [
          ["moonbitlang/x", 8],
          ["plv/unpacked", 9],
          ["plv/legacy", 10],
        ]
      );

      // What `.mooncakes` holds beats the floor written in the manifest
      const unpacked = await provider.resolve(entries[1], doc, noCancel);
      assert.equal(unpacked.license, "BSD-3-Clause");
      assert.equal(unpacked.version, "0.3.7");
      assert.equal(unpacked.source, "local");
      assert.match(
        buildHover(entries[1], unpacked)?.value ?? "",
        /https:\/\/mooncakes\.io\/docs\/plv\/unpacked@0\.3\.7/
      );

      // A moon.work member is built from the repository, not from the registry
      const member = await provider.resolve(entries[2], doc, noCancel);
      assert.deepEqual(member, { source: "skipped", detail: "built from a `moon.work` member" });

      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand("packageLicenseViewer.refresh");
    } finally {
      cache.dispose();
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    }
  });

  test("reads the legacy JSON manifest and leaves path and git dependencies alone", async () => {
    const cache = memoryCache();
    try {
      const document = await vscode.workspace.openTextDocument(uri("legacy", "moon.mod.json"));
      const doc = toTextDocumentLike(document);
      const provider = findProvider(createProviders(cache, vscodeProviderHost), doc);
      assert.ok(provider instanceof MoonbitLicenseProvider);
      const entries = provider.parse(doc);
      assert.deepEqual(
        entries.map((entry) => entry.name),
        ["moonbitlang/x", "plv/pinned", "plv/vendored", "plv/fromgit"]
      );
      assert.deepEqual(await provider.resolve(entries[2], doc, noCancel), {
        source: "skipped",
        detail: "local path dependency",
      });
      assert.deepEqual(await provider.resolve(entries[3], doc, noCancel), {
        source: "skipped",
        detail: "git dependency",
      });
      // Nothing on disk knows this module, and requests are turned off in this workspace
      const pinned = await provider.resolve(entries[1], doc, noCancel);
      assert.equal(pinned.source, "unknown");
      assert.equal(pinned.version, "1.2.3");
    } finally {
      cache.dispose();
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    }
  });
});
