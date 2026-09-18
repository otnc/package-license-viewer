/** Build the smallest thing that behaves like a `vscode.TextDocument`. */
export function fakeDocument(text: string, fsPath = "/project/package.json") {
  const uri = "/" + fsPath.replace(/\\/g, "/").replace(/^\//, "");
  const lines = text.split("\n");
  return {
    uri,
    getText: () => text,
    lineCount: lines.length,
    positionAt(offset: number) {
      let remaining = offset;
      let line = 0;
      while (line < lines.length && remaining > lines[line].length) {
        remaining -= lines[line].length + 1;
        line++;
      }
      return { line, character: remaining };
    },
    lineAt: (index: number) => ({ text: lines[index] ?? "" }),
  };
}

interface DecorationOption {
  range: { startLine: number; startCharacter: number };
  hoverMessage?: unknown;
  renderOptions?: { after?: { contentText?: string } };
}

/**
 * An editor that records every setDecorations call, so tests can assert on what would actually
 * have been drawn.

 * The annotator spreads one annotation across several decoration types sharing the same range
 * (spacer/before/license/after — see annotator.ts), each contributing its own slice of the
 * `after.contentText`. `lastDecorations` merges the most recent call for every type back into one
 * entry per range, in first-seen type order, so tests can keep asserting on "what the user would
 * actually see" without knowing about the internal split.
 */
export function fakeEditor(document: ReturnType<typeof fakeDocument>) {
  const decorationsByType = new Map<unknown, DecorationOption[]>();
  const typeOrder: unknown[] = [];
  return {
    document,
    setDecorations(type: unknown, options: DecorationOption[]) {
      if (!decorationsByType.has(type)) {
        typeOrder.push(type);
      }
      decorationsByType.set(type, options);
    },
    get lastDecorations() {
      if (typeOrder.length === 0) {
        return undefined;
      }
      const merged = new Map<
        string,
        {
          range: DecorationOption["range"];
          hoverMessage?: unknown;
          renderOptions: { after: { contentText: string } };
        }
      >();
      for (const type of typeOrder) {
        for (const option of decorationsByType.get(type) ?? []) {
          const key = `${option.range.startLine}:${option.range.startCharacter}`;
          const text = option.renderOptions?.after?.contentText ?? "";
          const existing = merged.get(key);
          if (existing) {
            existing.renderOptions.after.contentText += text;
            existing.hoverMessage ??= option.hoverMessage;
          } else {
            merged.set(key, {
              range: option.range,
              hoverMessage: option.hoverMessage,
              renderOptions: { after: { contentText: text } },
            });
          }
        }
      }
      return [...merged.values()];
    },
    /** How many of the raw per-type decorations at this position carry a hoverMessage — VS Code shows one hover section per decoration sharing a range, so this must never exceed 1. */
    hoverMessageCountAt(line: number, character: number) {
      let count = 0;
      for (const type of typeOrder) {
        for (const option of decorationsByType.get(type) ?? []) {
          if (
            option.range.startLine === line &&
            option.range.startCharacter === character &&
            option.hoverMessage !== undefined
          ) {
            count++;
          }
        }
      }
      return count;
    },
  };
}
