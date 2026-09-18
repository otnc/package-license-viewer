import type { CancellationLike, DisposableLike } from "./types";

/** A `vscode`-free equivalent of `vscode.CancellationTokenSource` — a token that starts uncancelled and can be cancelled once, firing every listener registered at that point. */
export class CancellationTokenSource {
  private readonly listeners = new Set<(e: unknown) => unknown>();

  readonly token: CancellationLike = {
    isCancellationRequested: false,
    onCancellationRequested: (listener: (e: unknown) => unknown): DisposableLike => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    },
  };

  cancel(): void {
    if (this.token.isCancellationRequested) return;
    (this.token as { isCancellationRequested: boolean }).isCancellationRequested = true;
    for (const listener of this.listeners) listener(undefined);
  }

  dispose(): void {
    this.listeners.clear();
  }
}
