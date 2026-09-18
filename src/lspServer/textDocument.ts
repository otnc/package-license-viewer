import type { TextDocument } from "vscode-languageserver-textdocument";
import type { TextDocumentLike } from "../providers/types";

/** Adapts an LSP `TextDocument` to the same `TextDocumentLike` shape `annotator.ts` builds from a real `vscode.TextDocument`. */
export function toTextDocumentLike(document: TextDocument): TextDocumentLike {
  return {
    uri: document.uri,
    getText: () => document.getText(),
    lineCount: document.lineCount,
    lineAt: (line: number) => {
      const lines = document.getText().split(/\r?\n/);
      return { text: lines[line] ?? "" };
    },
    positionAt: (offset: number) => document.positionAt(offset),
  };
}
