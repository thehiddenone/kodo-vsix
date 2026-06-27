declare function acquireVsCodeApi(): {
  postMessage(msg: Record<string, unknown>): void;
  getState(): unknown;
  setState(state: unknown): void;
};

export const vscode = acquireVsCodeApi();
