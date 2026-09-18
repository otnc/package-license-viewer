import * as vscode from "vscode";

let channel: vscode.LogOutputChannel | undefined;

export function initLog(): vscode.LogOutputChannel {
  channel ??= vscode.window.createOutputChannel("Package License Viewer", { log: true });
  return channel;
}

export const log = {
  debug(message: string, ...args: unknown[]): void {
    channel?.debug(message, ...args);
  },
  info(message: string, ...args: unknown[]): void {
    channel?.info(message, ...args);
  },
  warn(message: string, ...args: unknown[]): void {
    channel?.warn(message, ...args);
  },
  error(message: string | Error, ...args: unknown[]): void {
    channel?.error(message as never, ...args);
  },
};
