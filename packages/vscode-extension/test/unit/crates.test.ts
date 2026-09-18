import { existsSync } from "node:fs";
import Module from "node:module";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { CratesLicenseProvider, LicenseCache } from "@plv/core";
import { Annotator } from "../../src/annotator";
import { vscodeProviderHost } from "../../src/vscodeFs";
import * as vscodeStub from "../support/vscodeStub";
import {
  setCommands,
  setSettings,
  setVisibleEditors,
  window,
  workspace,
} from "../support/vscodeStub";
import { fakeDocument, fakeEditor } from "../support/testHelpers";

declare const __dirname: string;
declare const __filename: string;
const require = Module.createRequire(__filename);

// The real dist/extension.js bundle below is loaded with plain require(), which — unlike an
// `import` statement — never goes through Vite's "vscode" alias in vitest.config.ts. Its own
// internal `require("vscode")` needs the same stub, so it's patched in here at the Node module
// loader level, the same way the pre-Vitest vscode-stub.js used to do it for every test file.
const patchable = Module as unknown as { _load: (...args: unknown[]) => unknown };
const originalLoad = patchable._load;
patchable._load = function (this: unknown, ...args: unknown[]) {
  if (args[0] === "vscode") return vscodeStub;
  return originalLoad.apply(this, args);
};

function makeCache() {
  return new LicenseCache({ get() {}, keys: () => [], async update() {} });
}
const apiVersion = (num: string, extra: Record<string, unknown> = {}) => ({
  crate: "real",
  num,
  license: "MIT OR Apache-2.0",
  yanked: false,
  ...extra,
});
const settle = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};

const EXT_DIST = `${__dirname}/../../dist`;

afterEach(() => {
  setSettings({});
  setVisibleEditors([]);
  setCommands({
    registerCommand(_name: string, _callback: (...args: unknown[]) => unknown) {
      return { dispose() {} };
    },
  });
});

test("the bundled extension loads and exposes its entry points", () => {
  const bundle = `${EXT_DIST}/extension.js`;
  if (!existsSync(bundle)) {
    return;
  }
  delete require.cache[require.resolve(bundle)];
  const extension = require(bundle);
  expect(typeof extension.activate).toBe("function");
  expect(typeof extension.deactivate).toBe("function");
});

test("Cargo resolution integrates with Annotator Refresh and independent manifests", async () => {
  vi.spyOn(workspace.fs, "readFile").mockImplementation(async () => {
    throw Object.assign(new Error("missing"), { code: "FileNotFound" });
  });
  setSettings({ "packageLicenseViewer.crates.useRegistry": false });
  const cache = makeCache();
  onTestFinished(() => cache.dispose());
  cache.set("crates:versions:v1:real", [{ version: "1.0.0", license: "MIT", yanked: false }]);
  const provider = new CratesLicenseProvider(cache, vscodeProviderHost);
  const editor = fakeEditor(
    fakeDocument('[dependencies]\na={package="real",version="1"}', "/project/Cargo.toml")
  );
  setVisibleEditors([editor]);
  const annotator = new Annotator([provider]);
  onTestFinished(() => annotator.dispose());
  annotator.refreshAll();
  await new Promise((r) => setTimeout(r, 350));
  expect(
    editor.lastDecorations!.some((d) => d.renderOptions.after.contentText!.includes("MIT"))
  ).toBe(true);
  cache.clear();
  annotator.invalidate();
  annotator.refreshAll();
  await new Promise((r) => setTimeout(r, 350));
  expect(editor.lastDecorations).toHaveLength(0);
});

test("an active Cargo update retries a cancelled shared lookup without a third event", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout"], now: Date.now() + 1_000_000_000 });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  vi.spyOn(workspace.fs, "readFile").mockImplementation(async () => {
    throw Object.assign(new Error("missing"), { code: "FileNotFound" });
  });
  let starts = 0;
  let aborts = 0;
  vi.spyOn(global, "fetch").mockImplementation((async (_url: string, options: RequestInit) => {
    starts++;
    if (starts === 1)
      return new Promise((_resolve, reject) =>
        options.signal!.addEventListener("abort", () => {
          aborts++;
          reject((options.signal as AbortSignal).reason);
        })
      );
    return { ok: true, json: async () => ({ versions: [apiVersion("1.0.0")] }) };
  }) as typeof fetch);
  const cache = makeCache();
  const provider = new CratesLicenseProvider(cache, vscodeProviderHost);
  const document = fakeDocument('[dependencies]\nreal="1"', "/reupdate/Cargo.toml");
  const editor = fakeEditor(document);
  setVisibleEditors([editor]);
  const annotator = new Annotator([provider]);
  onTestFinished(() => {
    annotator.dispose();
    cache.dispose();
  });
  const first = (annotator as unknown as { update(d: unknown): Promise<void> }).update(document);
  await settle();
  expect(starts).toBe(1);
  const second = (annotator as unknown as { update(d: unknown): Promise<void> }).update(document);
  await settle();
  vi.advanceTimersByTime(1000);
  await settle();
  await Promise.all([first, second]);
  expect(aborts).toBe(1);
  expect(starts).toBe(2);
  expect(
    editor.lastDecorations!.some((d) => d.renderOptions.after.contentText!.includes("MIT"))
  ).toBe(true);
});

test("Refresh during Cargo HTTP retries after the invalidated request settles", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout"], now: Date.now() + 2_000_000_000 });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  vi.spyOn(workspace.fs, "readFile").mockImplementation(async () => {
    throw Object.assign(new Error("missing"), { code: "FileNotFound" });
  });
  let starts = 0;
  let aborts = 0;
  vi.spyOn(global, "fetch").mockImplementation((async (_url: string, options: RequestInit) => {
    starts++;
    if (starts === 1)
      return new Promise((_resolve, reject) => {
        options.signal!.addEventListener("abort", () => {
          aborts++;
          reject((options.signal as AbortSignal).reason);
        });
      });
    return { ok: true, json: async () => ({ versions: [apiVersion("1.0.0")] }) };
  }) as typeof fetch);
  const cache = makeCache();
  const provider = new CratesLicenseProvider(cache, vscodeProviderHost);
  const document = fakeDocument('[dependencies]\nreal="1"', "/refresh/Cargo.toml");
  const editor = fakeEditor(document);
  setVisibleEditors([editor]);
  const annotator = new Annotator([provider]);
  onTestFinished(() => {
    annotator.dispose();
    cache.dispose();
  });
  const internals = annotator as unknown as {
    update(d: unknown): Promise<void>;
    results: Map<string, unknown>;
  };
  const first = internals.update(document);
  await settle();
  expect(starts).toBe(1);
  annotator.invalidate();
  annotator.refreshAll();
  await settle();
  await first;
  expect(internals.results.size, "invalidated failure must not repopulate results").toBe(0);
  vi.advanceTimersByTime(25);
  await settle();
  vi.advanceTimersByTime(1000);
  await settle();
  expect(starts).toBe(2);
  expect(aborts).toBe(1);
  expect(
    editor.lastDecorations!.some((d) => d.renderOptions.after.contentText!.includes("MIT"))
  ).toBe(true);
});

test("extension Refresh, Clear Cache and each Cargo setting invalidate the provider", async () => {
  const registered = new Map<string, (...args: unknown[]) => unknown>();
  setCommands({
    registerCommand(name: string, callback: (...args: unknown[]) => unknown) {
      registered.set(name, callback);
      return { dispose() {} };
    },
  });
  const { activate } = await import("../../src/extension.js");
  window.showInformationMessage = async () => undefined;
  let changed!: (event: { affectsConfiguration(section: string): boolean }) => void;
  vi.spyOn(workspace, "onDidChangeConfiguration").mockImplementation((callback: typeof changed) => {
    changed = callback;
    return { dispose() {} };
  });
  const invalidated = vi.spyOn(CratesLicenseProvider.prototype, "invalidate");
  const cleared = vi.spyOn(LicenseCache.prototype, "clear");
  const context = {
    globalState: { get() {}, async update() {} },
    subscriptions: [] as { dispose(): void }[],
  };
  setVisibleEditors([]);
  activate(context as never);
  onTestFinished(() => context.subscriptions.forEach((s) => s.dispose()));
  registered.get("packageLicenseViewer.refresh")!();
  await registered.get("packageLicenseViewer.clearCache")!();
  expect(cleared).toHaveBeenCalledTimes(1);
  for (const key of ["enabled", "useRegistry", "useLockfiles"]) {
    const full = `packageLicenseViewer.crates.${key}`;
    changed({
      affectsConfiguration: (section: string) => full === section || full.startsWith(section + "."),
    });
  }
  expect(invalidated).toHaveBeenCalledTimes(5);
});

test("the production-capable bundle parses Cargo and renders a cached license", async () => {
  const bundle = `${EXT_DIST}/extension.js`;
  if (!existsSync(bundle)) {
    return;
  }
  setCommands({
    registerCommand() {
      return { dispose() {} };
    },
  });
  vi.spyOn(workspace.fs, "readFile").mockImplementation(async () => {
    throw Object.assign(new Error("missing"), { code: "FileNotFound" });
  });
  setSettings({ "packageLicenseViewer.crates.useRegistry": false });
  const editor = fakeEditor(
    fakeDocument('[dependencies]\nalias={package="real",version="1"}', "/bundle/Cargo.toml")
  );
  setVisibleEditors([editor]);
  const context = {
    subscriptions: [] as { dispose(): void }[],
    globalState: {
      get() {
        return {
          "crates:versions:v1:real": {
            t: Date.now(),
            v: [{ version: "1.0.0", license: "MIT", yanked: false }],
          },
        };
      },
      async update() {},
    },
  };
  onTestFinished(() => context.subscriptions.forEach((s) => s.dispose()));
  delete require.cache[require.resolve(bundle)];
  require(bundle).activate(context);
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(
    editor.lastDecorations!.some((d) => d.renderOptions.after.contentText!.includes("MIT"))
  ).toBe(true);
  expect(editor.lastDecorations!.find((d) => d.hoverMessage)?.hoverMessage).toMatchObject({
    value: expect.stringMatching(/crates.io\/crates\/real\/1.0.0/),
  });
});
