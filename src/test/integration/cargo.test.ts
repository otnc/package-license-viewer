import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { toTextDocumentLike } from "../../annotator";
import { LicenseCache } from "../../cache";
import { buildHover } from "../../format";
import { createProviders, findProvider } from "../../providers";
import { CratesLicenseProvider } from "../../providers/crates";
import { workspaceManifestUri } from "../../providers/crates/workspace";

const noCancel: vscode.CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
};
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function uri(...parts: string[]): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  return vscode.Uri.joinPath(folder.uri, ...parts);
}

suite("Cargo-only workspace", () => {
  test("workspace paths preserve real URI scheme and authority across path forms", () => {
    for (const [base, reference, expected] of [
      ["/app", "/ws", "/ws/Cargo.toml"],
      ["/app", "../ws", "/ws/Cargo.toml"],
      ["/C:/app", "D:\\ws", "/D:/ws/Cargo.toml"],
      ["/C:/app", "D:/ws", "/D:/ws/Cargo.toml"],
      ["/C:/app/member", "..\\ws", "/C:/app/ws/Cargo.toml"],
      ["/C:/app", "\\ws", "/C:/ws/Cargo.toml"],
      ["/app", "literal\\name", "/app/literal\\name/Cargo.toml"],
    ]) {
      const directory = vscode.Uri.from({
        scheme: "vscode-remote",
        authority: "ssh-remote+host",
        path: base,
      });
      const result = workspaceManifestUri(directory, reference);
      assert.equal(result?.path, expected);
      assert.equal(result?.scheme, directory.scheme);
      assert.equal(result?.authority, directory.authority);
    }
    const local = vscode.Uri.file("C:\\app");
    for (const reference of [
      "//server/share/ws",
      "/\\server/share/ws",
      "\\/server/share/ws",
      "//?/C:/ws",
    ]) {
      const remote = vscode.Uri.from({
        scheme: "vscode-remote",
        authority: "ssh-remote+host",
        path: "/C:/app",
      });
      assert.equal(workspaceManifestUri(remote, reference), undefined, reference);
      if (process.platform === "win32")
        assert.equal(workspaceManifestUri(local, reference), undefined, reference);
    }
    if (process.platform === "win32")
      assert.equal(workspaceManifestUri(local, "D:\\ws")?.fsPath, "d:\\ws\\Cargo.toml");
  });
  test("activates automatically before any document or command is opened", async () => {
    assert.equal(vscode.window.visibleTextEditors.length, 0);
    const extension = vscode.extensions.getExtension("otoneko1102.package-license-viewer");
    assert.ok(extension);
    const deadline = Date.now() + 20_000;
    while (!extension.isActive && Date.now() < deadline) await delay(50);
    assert.equal(
      extension.isActive,
      true,
      "workspaceContains must activate the production bundle without extension.activate()"
    );
  });

  test("dispatches plaintext Cargo.toml, reads inherited aliases, and builds the existing Hover", async () => {
    const cache = new LicenseCache({
      keys: () => [],
      get: <T>(_key: string, fallback?: T) => fallback,
      update: async () => {},
    });
    try {
      cache.set("crates:metadata:v1:semver@1.0.27", {
        version: "1.0.27",
        license: "MIT OR Apache-2.0",
        yanked: false,
      });
      const document = await vscode.workspace.openTextDocument(uri("member", "Cargo.toml"));
      assert.equal(document.languageId, "plaintext");
      assert.equal(
        vscode.workspace.getConfiguration("packageLicenseViewer").get("crates.useRegistry"),
        false
      );
      const doc = toTextDocumentLike(document);
      const providers = createProviders(cache);
      const provider = findProvider(providers, doc);
      assert.ok(provider instanceof CratesLicenseProvider);
      const entries = provider.parse(doc);
      assert.deepEqual(
        entries.map((e) => [e.name, e.line]),
        [
          ["alias", 5],
          ["private", 6],
        ]
      );
      const result = await provider.resolve(entries[0], doc, noCancel);
      assert.equal(result.license, "MIT OR Apache-2.0");
      assert.match(result.via ?? "", /Cargo.lock/);
      assert.match(
        buildHover(entries[0], result)?.value ?? "",
        /https:\/\/crates.io\/crates\/semver\/1.0.27/
      );
      assert.equal((await provider.resolve(entries[1], doc, noCancel)).source, "skipped");
      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand("packageLicenseViewer.refresh");
      const settings = vscode.workspace.getConfiguration("packageLicenseViewer");
      await settings.update("crates.enabled", false, vscode.ConfigurationTarget.Workspace);
      assert.equal(findProvider(providers, doc), undefined);
      await settings.update("crates.enabled", undefined, vscode.ConfigurationTarget.Workspace);
      assert.equal(findProvider(providers, doc)?.id, "crates");
      const edit = new vscode.WorkspaceEdit();
      edit.insert(document.uri, new vscode.Position(7, 0), '\n[dev-dependencies]\nother = "1"\n');
      assert.equal(await vscode.workspace.applyEdit(edit), true);
      assert.equal(document.isDirty, true);
      assert.equal(provider.parse(doc).at(-1)?.name, "other");
      await vscode.commands.executeCommand("workbench.action.files.revert");
      const cleared = vscode.commands.executeCommand("packageLicenseViewer.clearCache");
      await delay(100);
      await vscode.commands.executeCommand("notifications.clearAll");
      await cleared;
    } finally {
      cache.dispose();
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    }
  });
});
