import * as vscode from "vscode";
import {
  CONFIG_SECTION,
  LicenseCache,
  createProviders,
  initLog,
  invalidateConfigCache,
  log,
} from "@plv/core";
import { Annotator } from "./annotator";
import { vscodeProviderHost } from "./vscodeFs";

export function activate(context: vscode.ExtensionContext): void {
  const channel = initLog();
  const cache = new LicenseCache(context.globalState);
  const providers = createProviders(cache, vscodeProviderHost);
  const annotator = new Annotator(providers);

  context.subscriptions.push(
    channel,
    { dispose: () => cache.dispose() },
    annotator,

    vscode.commands.registerCommand("packageLicenseViewer.refresh", () => {
      annotator.invalidate();
      annotator.refreshAll();
    }),

    vscode.commands.registerCommand("packageLicenseViewer.clearCache", async () => {
      cache.clear();
      annotator.invalidate();
      annotator.refreshAll();
      await vscode.window.showInformationMessage("Package License Viewer: license cache cleared.");
    }),

    vscode.commands.registerCommand("packageLicenseViewer.toggle", async () => {
      const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
      const next = !config.get<boolean>("enabled", true);
      await config.update("enabled", next, vscode.ConfigurationTarget.Global);
      annotator.refreshAll();
    }),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(CONFIG_SECTION)) {
        return;
      }
      invalidateConfigCache();
      if (
        event.affectsConfiguration(`${CONFIG_SECTION}.annotationColor`) ||
        event.affectsConfiguration(`${CONFIG_SECTION}.licenseColor`) ||
        event.affectsConfiguration(`${CONFIG_SECTION}.margin`)
      ) {
        annotator.recreateDecorationType();
      }
      if (
        event.affectsConfiguration(`${CONFIG_SECTION}.npm`) ||
        event.affectsConfiguration(`${CONFIG_SECTION}.jsr`) ||
        event.affectsConfiguration(`${CONFIG_SECTION}.crates`) ||
        event.affectsConfiguration(`${CONFIG_SECTION}.cacheTtlHours`)
      ) {
        annotator.invalidate();
      }
      annotator.refreshAll();
    })
  );

  annotator.refreshAll();
  log.info("Package License Viewer activated");
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions
}
