import { afterEach, expect, test } from "vitest";
import type { CancellationLike, DependencyEntry, LicenseInfo, TextDocumentLike } from "@plv/core";
import { Annotator } from "../../src/annotator";
import { CancellationTokenSource, setSettings, setVisibleEditors } from "../support/vscodeStub";
import { fakeDocument, fakeEditor } from "../support/testHelpers";

const MANIFEST = `{
  "name": "demo",
  "dependencies": {
    "alpha": "^1.0.0",
    "bravo": "^2.0.0",
    "charlie": "^3.0.0",
    "delta": "^4.0.0",
    "echo": "^5.0.0"
  }
}`;

const DEPENDENCY_COUNT = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A provider that answers after a delay, so resolution really is still in flight */
class SlowProvider {
  readonly id = "fake";
  resolveCalls = 0;
  isEnabled = () => true;
  constructor(private readonly delayMs: number) {}
  supports() {
    return true;
  }
  parse(document: TextDocumentLike): DependencyEntry[] {
    const entries: DependencyEntry[] = [];
    const lines = document.getText().split("\n");
    lines.forEach((text, line) => {
      const match = /^\s+"([a-z]+)":\s*"(\^[\d.]+)"/.exec(text);
      if (match) {
        entries.push({ name: match[1], spec: match[2], section: "dependencies", line });
      }
    });
    return entries;
  }
  cacheKey(entry: DependencyEntry) {
    return `${this.id}:${entry.name}@${entry.spec}`;
  }
  async resolve(_entry: DependencyEntry): Promise<LicenseInfo> {
    this.resolveCalls++;
    await sleep(this.delayMs);
    return { license: "MIT", version: "1.0.0", source: "local" };
  }
}

function setup(provider: SlowProvider) {
  const document = fakeDocument(MANIFEST);
  const editor = fakeEditor(document);
  setVisibleEditors([editor]);
  return { document, editor, annotator: new Annotator([provider]) };
}

afterEach(() => {
  setSettings({});
  setVisibleEditors([]);
});

/**
 * The regression this file exists for.

 * Opening a manifest fires activation, onDidChangeActiveTextEditor and onDidChangeVisibleTextEditors in quick succession. Each update used to cancel the previous one, and because in-flight resolutions are shared by cache key, a newer update would end up awaiting a promise created by an older, now-cancelled one. The answer arrived correctly and was then discarded purely because the *first* caller's token had been cancelled, so those dependencies showed no license until some later event happened to redraw them. That looked like "only some packages get a license, and they take a while to show up".
 */
test("a burst of refreshes still annotates every dependency", async () => {
  const provider = new SlowProvider(40);
  const { editor, annotator } = setup(provider);

  // Three refreshes back to back, exactly like opening a package.json
  annotator.refreshAll();
  annotator.refreshAll();
  annotator.refreshAll();

  await sleep(400);

  expect(editor.lastDecorations, "the editor should have been decorated").toBeTruthy();
  expect(
    editor.lastDecorations!.length,
    "every dependency should end up annotated after a burst of refreshes"
  ).toBe(DEPENDENCY_COUNT);
  annotator.dispose();
});

test("each dependency is resolved only once across a burst of refreshes", async () => {
  const provider = new SlowProvider(10);
  const { annotator } = setup(provider);

  annotator.refreshAll();
  annotator.refreshAll();
  annotator.refreshAll();

  await sleep(300);

  expect(
    provider.resolveCalls,
    "each dependency should be resolved once, not once per refresh"
  ).toBe(DEPENDENCY_COUNT);
  annotator.dispose();
});

test("annotations land on the line of their dependency", async () => {
  const provider = new SlowProvider(0);
  const { document, editor, annotator } = setup(provider);

  annotator.refreshAll();
  await sleep(300);

  const decorations = editor.lastDecorations ?? [];
  expect(decorations).toHaveLength(DEPENDENCY_COUNT);
  for (const decoration of decorations) {
    const line = decoration.range.startLine;
    const text = document.lineAt(line).text;
    expect(text).toMatch(/"(alpha|bravo|charlie|delta|echo)"/);
    // The annotation is drawn at the end of the line
    expect(decoration.range.startCharacter).toBe(text.length);
    expect(decoration.renderOptions.after.contentText).toBe("MIT");
  }
  annotator.dispose();
});

// The license is drawn in its own colour via a decoration split into spacer/before/license/after pieces that all share the same range (see annotator.ts). Attaching the same hoverMessage to more than one of them made the hover popup show the same content once per piece — reported as the popup looking "tripled".
test("hovering an annotation shows the tooltip only once, even with several visible pieces", async () => {
  const provider = new SlowProvider(0);
  provider.resolve = async (): Promise<LicenseInfo> => {
    provider.resolveCalls++;
    return { license: "MIT", version: "1.0.0", source: "local", nodeEngine: ">=18" };
  };
  const { editor, annotator } = setup(provider);

  annotator.refreshAll();
  await sleep(300);

  // With engines.node shown, both the `license` and `after` (" (Node: >=18)") pieces are drawn — exactly the shape that used to trigger the duplicate hover.
  const decorations = editor.lastDecorations ?? [];
  expect(decorations).toHaveLength(DEPENDENCY_COUNT);
  for (const decoration of decorations) {
    expect(decoration.renderOptions.after.contentText).toBe("MIT (Node: >=18)");
    expect(
      editor.hoverMessageCountAt(decoration.range.startLine, decoration.range.startCharacter)
    ).toBe(1);
  }
  annotator.dispose();
});

test("results are reused on a later refresh rather than resolved again", async () => {
  const provider = new SlowProvider(0);
  const { annotator } = setup(provider);

  annotator.refreshAll();
  await sleep(200);
  expect(provider.resolveCalls).toBe(DEPENDENCY_COUNT);

  annotator.refreshAll();
  await sleep(200);
  expect(provider.resolveCalls, "cached results should be reused").toBe(DEPENDENCY_COUNT);

  // invalidate() drops them, so the next pass has to resolve again
  annotator.invalidate();
  annotator.refreshAll();
  await sleep(200);
  expect(provider.resolveCalls).toBe(DEPENDENCY_COUNT * 2);

  annotator.dispose();
});

test("a provider that throws does not stop the other dependencies", async () => {
  const provider = new SlowProvider(0);
  provider.resolve = async (entry: DependencyEntry): Promise<LicenseInfo> => {
    provider.resolveCalls++;
    if (entry.name === "charlie") {
      throw new Error("boom");
    }
    return { license: "MIT", version: "1.0.0", source: "local" };
  };
  const { editor, annotator } = setup(provider);

  annotator.refreshAll();
  await sleep(300);

  expect(
    (editor.lastDecorations ?? []).length,
    "the failing dependency is skipped, the rest are still annotated"
  ).toBe(DEPENDENCY_COUNT - 1);
  annotator.dispose();
});

test("shared lookups retry only cancelled failures for live waiters", async () => {
  for (const [source, cancelOwner, cancelWaiter, expected] of [
    ["unknown", true, false, 2],
    ["unknown", false, false, 1],
    ["unknown", true, true, 1],
    ["registry", true, false, 1],
  ] as const) {
    const provider = new SlowProvider(0);
    const { annotator, document } = setup(provider);
    const owner = new CancellationTokenSource();
    const waiter = new CancellationTokenSource();
    let finish!: (info: LicenseInfo) => void;
    provider.resolve = async (): Promise<LicenseInfo> => {
      provider.resolveCalls++;
      if (provider.resolveCalls === 1)
        return new Promise((resolve) => {
          finish = resolve;
        });
      return { source: "registry", license: "MIT" };
    };
    const entry = provider.parse(document)[0];
    const first = (annotator as unknown as AnnotatorInternals).resolveEntry(
      provider,
      entry,
      document,
      owner.token
    );
    const second = (annotator as unknown as AnnotatorInternals).resolveEntry(
      provider,
      entry,
      document,
      waiter.token
    );
    const third = (annotator as unknown as AnnotatorInternals).resolveEntry(
      provider,
      entry,
      document,
      waiter.token
    );
    if (cancelOwner) owner.cancel();
    if (cancelWaiter) waiter.cancel();
    finish({ source, license: source === "registry" ? "MIT" : undefined });
    await Promise.all([first, second, third]);
    expect(provider.resolveCalls, `${source}/${cancelOwner}/${cancelWaiter}`).toBe(expected);
    annotator.dispose();
  }
});

test("invalidated lookups cannot store stale successes or remove their replacements", async () => {
  const provider = new SlowProvider(0);
  const { annotator, document } = setup(provider);
  const finishes: ((info: LicenseInfo) => void)[] = [];
  provider.resolve = () => new Promise((resolve) => finishes.push(resolve));
  const entry = provider.parse(document)[0];
  const token = new CancellationTokenSource().token;
  const internals = annotator as unknown as AnnotatorInternals;
  const old = internals.resolveEntry(provider, entry, document, token);
  annotator.invalidate();
  const current = internals.resolveEntry(provider, entry, document, token);
  finishes[0]({ source: "registry", license: "stale" });
  await old;
  expect(internals.results.size).toBe(0);
  expect(internals.inflight.size).toBe(1);
  const shared = internals.resolveEntry(provider, entry, document, token);
  expect(finishes).toHaveLength(2);
  finishes[1]({ source: "registry", license: "MIT" });
  await Promise.all([current, shared]);
  expect(internals.inflight.size).toBe(0);
  expect([...internals.results.values()][0].info.license).toBe("MIT");
  annotator.dispose();
});

test("disabled annotations stay hidden when an earlier lookup completes", async () => {
  for (const disableProvider of [false, true]) {
    let enabled = true;
    let finish!: (info: LicenseInfo) => void;
    setSettings({ "packageLicenseViewer.enabled": disableProvider || enabled });
    const provider = new SlowProvider(0);
    provider.isEnabled = () => !disableProvider || enabled;
    const pending = new Promise<LicenseInfo>((resolve) => {
      finish = resolve;
    });
    provider.resolve = () => pending;
    const { annotator, document, editor } = setup(provider);
    const internals = annotator as unknown as AnnotatorInternals;
    const first = internals.update(document);
    expect(finish).toBeTruthy();
    enabled = false;
    setSettings({ "packageLicenseViewer.enabled": disableProvider || enabled });
    await internals.update(document);
    expect(editor.lastDecorations!.length).toBe(0);
    // Providers may still finish successfully after cancellation.
    finish({ source: "registry", license: "MIT" });
    await first;
    expect(editor.lastDecorations!.length).toBe(0);
    enabled = true;
    setSettings({ "packageLicenseViewer.enabled": disableProvider || enabled });
    await internals.update(document);
    expect(editor.lastDecorations!.length).toBe(DEPENDENCY_COUNT);
    annotator.dispose();
  }
});

/** The private members these tests reach into directly, to exercise sharing/invalidation without waiting on real timing. */
interface AnnotatorInternals {
  update(document: TextDocumentLike): Promise<void>;
  resolveEntry(
    provider: SlowProvider,
    entry: DependencyEntry,
    document: TextDocumentLike,
    token: CancellationLike
  ): Promise<LicenseInfo>;
  results: Map<string, { info: LicenseInfo }>;
  inflight: Map<string, unknown>;
}
