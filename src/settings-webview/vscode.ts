import type { OutboundMessage } from './types';

declare function acquireVsCodeApi(): {
  postMessage(msg: OutboundMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

export const vscode = acquireVsCodeApi();
