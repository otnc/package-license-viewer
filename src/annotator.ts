import * as vscode from "vscode";
import { getConfig } from "./config";
import { buildHover, formatAnnotationSegments } from "./format";
import { log } from "./log";
import { runWithConcurrency } from "./net";
import {
  findProvider,
  type DependencyEntry,
  type LicenseInfo,
  type LicenseProvider,
  type TextDocumentLike,
} from "./providers";

/** How long to wait after the last keystroke before re-resolving */
const DEBOUNCE_MS = 300;
/**
 * Even an "immediate" refresh waits this long.

 * Opening a manifest fires activation, onDidChangeActiveTextEditor and onDidChangeVisibleTextEditors in a burst. Without coalescing, each one starts an update that cancels the previous, which is both wasteful and a source of dropped work.
 */
const COALESCE_MS = 25;
/** Paint partial results at this interval while resolution is still running */
const PROGRESS_FLUSH_MS = 50;
/**
 * How long a resolved result stays fresh in memory.

 * Past this we resolve again, but the old value keeps being drawn in the meantime, so nothing flickers. It is also what makes annotations follow along after an `npm install`.
 */
const RESULT_TTL_MS = 60_000;

interface StoredResult {
  at: number;
  info: LicenseInfo;
}

/** Adapts a real `vscode.TextDocument` to the editor-agnostic shape providers expect */
export function toTextDocumentLike(document: vscode.TextDocument): TextDocumentLike {
  return {
    uri: document.uri.toString(),
    getText: () => document.getText(),
    lineCount: document.lineCount,
    lineAt: (line) => document.lineAt(line),
    positionAt: (offset) => document.positionAt(offset),
  };
}

/**
 * Draws the license at the end of each dependency line.

 * The annotation is split across four decoration types sharing the exact same zero-width range (there is nothing after the end of a line to anchor a second position on) so the license value can be drawn in its own colour: an invisible `spacer` that carries the margin between the code and the annotation, `before`/`after` for whatever surrounds the license in the template (empty for the default `${license}` template), and `license` itself. All four are created once, in this fixed order, so their left-to-right render order stays stable.
 */
export class Annotator implements vscode.Disposable {
  private decorationTypes: AnnotationDecorationTypes;
  private readonly results = new Map<string, StoredResult>();
  private generation = 0;
  private readonly inflight = new Map<
    string,
    { promise: Promise<LicenseInfo>; token: vscode.CancellationToken }
  >();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly cancellations = new Map<string, vscode.CancellationTokenSource>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly providers: readonly LicenseProvider[]) {
    this.decorationTypes = createDecorationTypes();

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.schedule(editor.document, true);
        }
      }),
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        for (const editor of editors) {
          this.schedule(editor.document, true);
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.schedule(event.document, false);
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        this.schedule(document, true);
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.cancel(document.uri.toString());
      })
    );
  }

  /** Redraw every visible editor */
  refreshAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.schedule(editor.document, true);
    }
  }

  /** Throw away resolved results so the next pass fetches them again */
  invalidate(): void {
    this.generation++;
    for (const key of this.cancellations.keys()) this.cancel(key);
    this.inflight.clear();
    this.results.clear();
    for (const provider of this.providers) {
      (provider as { invalidate?: () => void }).invalidate?.();
    }
  }

  /** Rebuild the decoration styles after a colour or spacing setting changed */
  recreateDecorationType(): void {
    for (const type of Object.values(this.decorationTypes)) {
      type.dispose();
    }
    this.decorationTypes = createDecorationTypes();
  }

  private schedule(document: vscode.TextDocument, immediate: boolean): void {
    const key = document.uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const run = () => {
      this.debounceTimers.delete(key);
      void this.update(document).catch((error) => log.error(`update failed: ${String(error)}`));
    };
    this.debounceTimers.set(key, setTimeout(run, immediate ? COALESCE_MS : DEBOUNCE_MS));
  }

  private async update(document: vscode.TextDocument): Promise<void> {
    const key = document.uri.toString();
    const editors = vscode.window.visibleTextEditors.filter(
      (editor) => editor.document.uri.toString() === key
    );
    if (editors.length === 0) {
      return;
    }

    const config = getConfig(document);
    const doc = toTextDocumentLike(document);
    const provider = config.enabled ? findProvider(this.providers, doc) : undefined;
    if (!provider) {
      this.cancel(key);
      this.setDecorations(editors, emptyAnnotationOptions());
      return;
    }

    this.cancel(key);
    const cts = new vscode.CancellationTokenSource();
    this.cancellations.set(key, cts);

    let entries: DependencyEntry[];
    try {
      entries = provider.parse(doc);
    } catch (error) {
      log.warn(`parse failed for ${key}: ${String(error)}`);
      this.setDecorations(editors, emptyAnnotationOptions());
      return;
    }

    // Draw what we already know first, so typing does not make annotations blink
    this.render(document, editors, provider, entries);

    const now = Date.now();
    const pending = entries.filter((entry) => {
      const stored = this.results.get(this.keyOf(provider, entry));
      return !stored || now - stored.at > RESULT_TTL_MS;
    });
    if (pending.length === 0) {
      return;
    }

    let flushTimer: NodeJS.Timeout | undefined;
    const scheduleFlush = () => {
      if (flushTimer || cts.token.isCancellationRequested) {
        return;
      }
      flushTimer = setTimeout(() => {
        flushTimer = undefined;
        if (!cts.token.isCancellationRequested) {
          this.render(document, editors, provider, entries);
        }
      }, PROGRESS_FLUSH_MS);
    };

    const tasks = pending.map((entry) => async () => {
      if (cts.token.isCancellationRequested) {
        return;
      }
      await this.resolveEntry(provider, entry, doc, cts.token);
      scheduleFlush();
    });

    try {
      await runWithConcurrency(tasks, config.maxConcurrentRequests);
    } finally {
      if (flushTimer) {
        clearTimeout(flushTimer);
      }
      if (this.cancellations.get(key) === cts) {
        this.cancellations.delete(key);
      }
      cts.dispose();
    }

    if (!cts.token.isCancellationRequested) {
      this.render(document, editors, provider, entries);
    }
  }

  /** Resolve one entry, making sure the same package is never fetched twice at once */
  private async resolveEntry(
    provider: LicenseProvider,
    entry: DependencyEntry,
    document: TextDocumentLike,
    token: vscode.CancellationToken
  ): Promise<LicenseInfo> {
    const key = this.keyOf(provider, entry);
    const existing = this.inflight.get(key);
    if (existing) {
      const info = await existing.promise;
      // A live update must take over failed work owned by a cancelled update.
      // Successful answers and ordinary failures remain shared, without retries.
      if (
        info.source === "unknown" &&
        existing.token.isCancellationRequested &&
        !token.isCancellationRequested
      ) {
        return this.resolveEntry(provider, entry, document, token);
      }
      return info;
    }

    const generation = this.generation;
    const promise = provider
      .resolve(entry, document, token)
      .catch((error): LicenseInfo => {
        log.warn(`resolve failed for ${key}: ${String(error)}`);
        return { source: "unknown", detail: String(error) };
      })
      .then((info) => {
        // Never throw away a good answer. This promise is shared, so the token belongs to whichever update asked first — and that update may since have been superseded and cancelled while a newer one was already waiting on the very same promise. Only a cancelled *failure* is discarded, so that it gets retried instead of being remembered as "unknown" for the whole TTL.
        const cancelledFailure = info.source === "unknown" && token.isCancellationRequested;
        if (generation === this.generation && !cancelledFailure) {
          this.results.set(key, { at: Date.now(), info });
        }
        return info;
      })
      .finally(() => {
        // An invalidated lookup must not remove its replacement.
        if (this.inflight.get(key)?.promise === promise) this.inflight.delete(key);
      });

    this.inflight.set(key, { promise, token });
    return promise;
  }

  private render(
    document: vscode.TextDocument,
    editors: readonly vscode.TextEditor[],
    provider: LicenseProvider,
    entries: readonly DependencyEntry[]
  ): void {
    const config = getConfig(document);
    const options = emptyAnnotationOptions();

    for (const entry of entries) {
      const stored = this.results.get(this.keyOf(provider, entry));
      if (!stored) {
        continue;
      }
      const segments = formatAnnotationSegments(config, entry, stored.info);
      if (!segments) {
        continue;
      }
      if (entry.line < 0 || entry.line >= document.lineCount) {
        continue;
      }
      const endColumn = document.lineAt(entry.line).text.length;
      const range = new vscode.Range(entry.line, endColumn, entry.line, endColumn);
      const hoverMessage = buildHover(entry, stored.info);

      // All four decorations share the exact same range, so attaching the same hoverMessage to more than one of them makes VS Code show it once per decoration — one hover popup with the content repeated. Only the segment that actually carries the visible text gets it, preferring license (the common case) over before/after, and the spacer as a last resort for the rare case where all three are somehow empty.
      const hoverTarget = segments.license
        ? "license"
        : segments.before
          ? "before"
          : segments.after
            ? "after"
            : "spacer";

      options.spacer.push({
        range,
        hoverMessage: hoverTarget === "spacer" ? hoverMessage : undefined,
      });
      if (segments.before) {
        options.before.push({
          range,
          hoverMessage: hoverTarget === "before" ? hoverMessage : undefined,
          renderOptions: contentOptions(segments.before),
        });
      }
      if (segments.license) {
        options.license.push({
          range,
          hoverMessage: hoverTarget === "license" ? hoverMessage : undefined,
          renderOptions: contentOptions(segments.license),
        });
      }
      if (segments.after) {
        options.after.push({
          range,
          hoverMessage: hoverTarget === "after" ? hoverMessage : undefined,
          renderOptions: contentOptions(segments.after),
        });
      }
    }

    this.setDecorations(editors, options);
  }

  private setDecorations(editors: readonly vscode.TextEditor[], options: AnnotationOptions): void {
    for (const editor of editors) {
      editor.setDecorations(this.decorationTypes.spacer, options.spacer);
      editor.setDecorations(this.decorationTypes.before, options.before);
      editor.setDecorations(this.decorationTypes.license, options.license);
      editor.setDecorations(this.decorationTypes.after, options.after);
    }
  }

  private keyOf(provider: LicenseProvider, entry: DependencyEntry): string {
    return (
      provider.cacheKey(entry) ?? `${provider.id}:${entry.section}:${entry.name}@${entry.spec}`
    );
  }

  private cancel(documentKey: string): void {
    const cts = this.cancellations.get(documentKey);
    if (cts) {
      cts.cancel();
      cts.dispose();
      this.cancellations.delete(documentKey);
    }
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    for (const key of [...this.cancellations.keys()]) {
      this.cancel(key);
    }
    for (const type of Object.values(this.decorationTypes)) {
      type.dispose();
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

interface AnnotationDecorationTypes {
  /** Invisible; carries the margin between the code and wherever the visible text starts */
  readonly spacer: vscode.TextEditorDecorationType;
  readonly before: vscode.TextEditorDecorationType;
  readonly license: vscode.TextEditorDecorationType;
  readonly after: vscode.TextEditorDecorationType;
}

interface AnnotationOptions {
  readonly spacer: vscode.DecorationOptions[];
  readonly before: vscode.DecorationOptions[];
  readonly license: vscode.DecorationOptions[];
  readonly after: vscode.DecorationOptions[];
}

function emptyAnnotationOptions(): AnnotationOptions {
  return { spacer: [], before: [], license: [], after: [] };
}

function contentOptions(contentText: string): vscode.DecorationInstanceRenderOptions {
  return { after: { contentText } };
}

/**
 * Four decoration types sharing one visual line of text: `spacer` supplies the margin (with no content of its own, so it renders even when before/after are empty), `before`/`after` share `annotationColor`, and `license` gets its own `licenseColor`. Created in this fixed order so that whichever of before/license/after actually has content each render still lines up left-to-right in template order.
 */
function createDecorationTypes(): AnnotationDecorationTypes {
  const config = getConfig();
  const base: vscode.DecorationRenderOptions = {
    isWholeLine: false,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
  };
  return {
    spacer: vscode.window.createTextEditorDecorationType({
      ...base,
      after: { contentText: "", margin: config.margin },
    }),
    before: vscode.window.createTextEditorDecorationType({
      ...base,
      after: { margin: "0", color: resolveColor(config.annotationColor), fontStyle: "italic" },
    }),
    license: vscode.window.createTextEditorDecorationType({
      ...base,
      after: { margin: "0", color: resolveColor(config.licenseColor), fontStyle: "italic" },
    }),
    after: vscode.window.createTextEditorDecorationType({
      ...base,
      after: { margin: "0", color: resolveColor(config.annotationColor), fontStyle: "italic" },
    }),
  };
}

/** Accepts either a theme colour id or a plain CSS colour */
function resolveColor(value: string): vscode.ThemeColor | string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return new vscode.ThemeColor("editorCodeLens.foreground");
  }
  if (/^(#|rgba?\(|hsla?\(|var\()/i.test(trimmed)) {
    return trimmed;
  }
  return new vscode.ThemeColor(trimmed);
}
