import * as assert from "node:assert/strict";
import * as vscode from "vscode";

suite("standalone TOML activation", () => {
  test("opening a TOML document activates the bundle without a workspace", async () => {
    assert.equal(vscode.workspace.workspaceFolders, undefined);
    const extension = vscode.extensions.getExtension("otoneko1102.package-license-viewer");
    assert.ok(extension);
    assert.equal(extension.isActive, false);
    const document = await vscode.workspace.openTextDocument({
      language: "toml",
      content: '[dependencies]\nprivate = { path = "local" }\n',
    });
    await vscode.window.showTextDocument(document);
    const deadline = Date.now() + 20_000;
    while (!extension.isActive && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(extension.isActive, true);
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  });
});
