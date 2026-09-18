import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  JsrLicenseProvider,
  LicenseCache,
  NpmLicenseProvider,
  createProviders,
  findProvider,
  type LicenseProvider,
} from "@plv/core";
import { toTextDocumentLike } from "../../src/annotator";
import { vscodeProviderHost } from "../../src/vscodeFs";

const EXTENSION_ID = "otoneko1102.package-license-viewer";

/** A Memento good enough to stand in for context.globalState */
function memoryMemento(): vscode.Memento {
  const store = new Map<string, unknown>();
  return {
    keys: () => [...store.keys()],
    get: (<T>(key: string, fallback?: T) =>
      store.has(key) ? (store.get(key) as T) : fallback) as vscode.Memento["get"],
    update: async (key: string, value: unknown) => {
      if (value === undefined) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
    },
  };
}

function workspaceUri(...segments: string[]): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "the test workspace folder must be open");
  return vscode.Uri.joinPath(folder.uri, ...segments);
}

const noCancel = new vscode.CancellationTokenSource().token;

suite("activation", () => {
  test("the extension activates", async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} should be installed in the test host`);
    await extension.activate();
    assert.equal(extension.isActive, true);
  });

  test("every contributed command is registered", async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      "packageLicenseViewer.refresh",
      "packageLicenseViewer.clearCache",
      "packageLicenseViewer.toggle",
    ]) {
      assert.ok(commands.includes(id), `${id} should be registered`);
    }
  });

  test("refresh runs without throwing", async () => {
    const document = await vscode.workspace.openTextDocument(workspaceUri("package.json"));
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand("packageLicenseViewer.refresh");
  });
});

suite("provider dispatch", () => {
  let providers: LicenseProvider[];

  suiteSetup(() => {
    providers = createProviders(new LicenseCache(memoryMemento()), vscodeProviderHost);
  });

  test("package.json goes to the npm provider", async () => {
    const document = await vscode.workspace.openTextDocument(workspaceUri("package.json"));
    assert.equal(findProvider(providers, toTextDocumentLike(document))?.id, "npm");
  });

  test("deno.json goes to the jsr provider", async () => {
    const document = await vscode.workspace.openTextDocument(workspaceUri("deno.json"));
    assert.equal(findProvider(providers, toTextDocumentLike(document))?.id, "jsr");
  });

  test("a package.json inside node_modules is left alone", async () => {
    const document = await vscode.workspace.openTextDocument(
      workspaceUri("node_modules", "plv-local-pkg", "package.json")
    );
    assert.equal(findProvider(providers, toTextDocumentLike(document)), undefined);
  });
});

suite("parsing a real document", () => {
  test("dependencies are found on the right lines", async () => {
    const provider = new NpmLicenseProvider(new LicenseCache(memoryMemento()), vscodeProviderHost);
    const document = await vscode.workspace.openTextDocument(workspaceUri("package.json"));
    const entries = provider.parse(toTextDocumentLike(document));

    const names = entries.map((entry) => entry.name);
    assert.deepEqual(names, [
      "plv-local-pkg",
      "plv-legacy-pkg",
      "@plv/plv-scoped-pkg",
      "plv-locked-pkg",
      "plv-git-pkg",
      "plv-file-pkg",
      "plv-stale-pkg",
    ]);

    // peerDependenciesMeta holds objects, not specifiers, so it must not be picked up
    assert.equal(
      entries.some((entry) => entry.section === "peerDependenciesMeta"),
      false
    );

    // Every reported line must really contain that dependency
    for (const entry of entries) {
      const text = document.lineAt(entry.line).text;
      assert.ok(
        text.includes(`"${entry.name}"`),
        `line ${entry.line} should contain ${entry.name}, but was: ${text}`
      );
    }
  });

  test("deno.json imports are found", async () => {
    const provider = new JsrLicenseProvider(new LicenseCache(memoryMemento()), vscodeProviderHost);
    const document = await vscode.workspace.openTextDocument(workspaceUri("deno.json"));
    const entries = provider.parse(toTextDocumentLike(document));
    assert.deepEqual(
      entries.map((entry) => entry.name),
      ["@std/fs", "chalk"]
    );
  });
});

// These run with packageLicenseViewer.npm.useRegistry disabled in the fixture's .vscode/settings.json, so they prove the offline paths work through the real vscode.workspace.fs and vscode.Uri APIs — including on Windows paths.
suite("resolving offline", () => {
  let provider: NpmLicenseProvider;
  let document: vscode.TextDocument;
  let doc: ReturnType<typeof toTextDocumentLike>;

  suiteSetup(async () => {
    provider = new NpmLicenseProvider(new LicenseCache(memoryMemento()), vscodeProviderHost);
    document = await vscode.workspace.openTextDocument(workspaceUri("package.json"));
    doc = toTextDocumentLike(document);
  });

  const resolve = (name: string, spec: string) =>
    provider.resolve({ name, spec, section: "dependencies", line: 0 }, doc, noCancel);

  test("registry lookups really are disabled for this workspace", () => {
    const useRegistry = vscode.workspace
      .getConfiguration("packageLicenseViewer", document)
      .get<boolean>("npm.useRegistry");
    assert.equal(useRegistry, false, "the fixture settings must disable the registry");
  });

  test("an installed package is read from node_modules", async () => {
    const info = await resolve("plv-local-pkg", "^1.0.0");
    assert.equal(info.source, "local");
    assert.equal(info.license, "MIT");
    assert.equal(info.version, "1.2.0");
    assert.equal(info.homepage, "https://example.com/local");
  });

  test("a scoped package is read from node_modules", async () => {
    const info = await resolve("@plv/plv-scoped-pkg", "^1.0.0");
    assert.equal(info.source, "local");
    assert.equal(info.license, "ISC");
    assert.equal(info.version, "1.0.1");
  });

  test("the legacy licenses array is normalised", async () => {
    const info = await resolve("plv-legacy-pkg", "^1.0.0");
    assert.equal(info.license, "(MIT OR Apache-2.0)");
  });

  test("a package that is not installed comes from the lockfile", async () => {
    const info = await resolve("plv-locked-pkg", "^3.0.0");
    assert.equal(info.source, "lockfile");
    assert.equal(info.license, "BSD-3-Clause");
    assert.equal(info.version, "3.1.4");
    assert.match(String(info.via), /package-lock\.json/);
  });

  test("unresolvable specifiers are skipped rather than guessed", async () => {
    const git = await resolve("plv-git-pkg", "user/repo");
    assert.equal(git.source, "skipped");
    assert.equal(git.license, undefined);

    const file = await resolve("plv-file-pkg", "file:../elsewhere");
    assert.equal(file.source, "skipped");
  });

  test("a nested manifest resolves through the hoisted root node_modules", async () => {
    const inner = await vscode.workspace.openTextDocument(
      workspaceUri("packages", "inner", "package.json")
    );
    const info = await provider.resolve(
      { name: "plv-hoisted-pkg", spec: "^2.0.0", section: "dependencies", line: 0 },
      toTextDocumentLike(inner),
      noCancel
    );
    assert.equal(info.source, "local");
    assert.equal(info.license, "Apache-2.0");
    assert.equal(info.version, "2.3.4");
  });
});
