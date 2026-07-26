/**
 * Outbound half of the session-less control WebSocket (sidebar / llama /
 * picker) — sending a hello, fire-and-forget sends, and awaited
 * request/response round trips. The inbound dispatcher lives in
 * `control-channel.ts`; kept separate so every other feature module can send
 * on the control connection without importing that dispatcher (which in turn
 * imports most of those feature modules) — avoids a needless import cycle.
 */

import { makeRequest } from '../envelope';
import type { Envelope } from '../envelope';
import { state } from './state';

export function sendControlHello(): void {
  sendControl(
    makeRequest('hello', { client: 'vsix', version: '0.2.0', window_id: state.windowId, role: 'control' }),
  );
}

export function sendControl(env: Envelope): void {
  state.controlClient?.send(env);
}

export function sendControlAwait(
  type: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  const env = makeRequest(type, payload);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pendingControl.delete(env.id);
      reject(new Error(`Timed out waiting for ${type} response`));
    }, timeoutMs);
    state.pendingControl.set(env.id, (p) => {
      clearTimeout(timer);
      resolve(p);
    });
    sendControl(env);
  });
}
