/**
 * Reconnecting WebSocket client for the Kōdo wire protocol.
 *
 * Runs in the VS Code extension host (Node.js). Reconnects automatically
 * on close. Each incoming envelope is forwarded to the registered listener.
 */

import WebSocket from 'ws';
import { Envelope, fromJson, toJson } from './envelope';

const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_ATTEMPTS = 10;

export type EnvelopeListener = (env: Envelope) => void;
export type StatusListener = (connected: boolean) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private disposed = false;
  private everConnected = false;

  constructor(
    private readonly url: string,
    private readonly onEnvelope: EnvelopeListener,
    private readonly onStatus: StatusListener,
    /**
     * Fires once, at most, when the reconnect loop exhausts its attempts
     * without ever having connected — the signal that the server likely
     * failed to start (as opposed to a connection dropping mid-session).
     * Not called for drops after a successful initial connect.
     */
    private readonly onNeverConnected?: () => void,
  ) {}

  /** Open the connection (or start reconnect loop). */
  connect(): void {
    if (this.disposed) {
      return;
    }
    this.attempts++;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on('open', () => {
      this.attempts = 0;
      this.everConnected = true;
      this.onStatus(true);
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const env = fromJson(data.toString());
        this.onEnvelope(env);
      } catch {
        // Malformed frame — ignore
      }
    });

    ws.on('close', () => {
      this.ws = null;
      this.onStatus(false);
      this.scheduleReconnect();
    });

    ws.on('error', () => {
      // 'close' will fire after 'error'; nothing to do here
    });
  }

  /** Send an envelope. No-op if not connected. */
  send(env: Envelope): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(toJson(env));
    }
  }

  /** Permanently close the connection and stop reconnecting. */
  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  /**
   * Give the next {@link connect} call a fresh reconnect budget and re-arm
   * {@link onNeverConnected}. Used by a caller retrying after remediation
   * (e.g. a venv rebuild) so the retry gets the full attempt count rather
   * than immediately re-exhausting whatever was left over.
   */
  resetAttempts(): void {
    this.attempts = 0;
    this.everConnected = false;
  }

  private scheduleReconnect(): void {
    if (this.disposed) {
      return;
    }
    if (this.attempts >= MAX_RECONNECT_ATTEMPTS) {
      if (!this.everConnected) {
        this.onNeverConnected?.();
      }
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }
}
