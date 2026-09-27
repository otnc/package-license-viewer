import type { TextDocument } from "vscode-languageserver-textdocument";
import type { TextDocumentLike } from "@plv/core";

/** Adapts an LSP `TextDocument` to the same `TextDocumentLike` shape `annotator.ts` builds from a real `vscode.TextDocument`. */
export function toTextDocumentLike(document: TextDocument): TextDocumentLike {
  // Memoized per wrapper rather than per call: nothing here currently calls lineAt() more than
  // once for the same wrapper, but splitting the whole document on every call would be a real
  // cost if that changes, for no benefit within one resolution pass.
  let lines: string[] | undefined;
  return {
    uri: document.uri,
    getText: () => document.getText(),
    lineCount: document.lineCount,
    lineAt: (line: number) => {
      lines ??= document.getText().split(/\r?\n/);
      return { text: lines[line] ?? "" };
    },
    positionAt: (offset: number) => document.positionAt(offset),
  };
}
