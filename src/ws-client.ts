/**
 * Reconnecting WebSocket client for the Kōdo wire protocol.
 *
 * Runs in the VS Code extension host (Node.js). Reconnects automatically
 * on close. Each incoming envelope is forwarded to the registered listener.
 *
 * Two reconnect regimes:
 *   - Before the first successful connect: a fixed cadence with a finite
 *     budget, after which {@link WsClientOptions.onNeverConnected} fires — the
 *     server most likely failed to start.
 *   - After it: never give up, backing off to a cap. A server that went away
 *     and came back (relaunched by this or another window) is picked up
 *     without a window reload.
 * Either way the owner can veto the next attempt from
 * {@link WsClientOptions.onFailure} (e.g. to relaunch the server first) and
 * restart the loop later with {@link WsClient.connect}.
 */

import WebSocket from 'ws';
import { Envelope, fromJson, toJson } from './envelope';

const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 10_000;
const MAX_RECONNECT_ATTEMPTS = 10;

export type EnvelopeListener = (env: Envelope) => void;
export type StatusListener = (connected: boolean) => void;

/** `'stop'` ends the reconnect loop; the owner restarts it with `connect()`. */
export type FailureVerdict = 'retry' | 'stop';

/**
 * Consulted after every failed attempt or dropped connection, before the next
 * attempt is scheduled. `wasOpen` is `true` for a drop (the socket had opened)
 * and `false` for an attempt that never connected.
 */
export type FailureListener = (wasOpen: boolean) => FailureVerdict | Promise<FailureVerdict>;

export interface WsClientOptions {
  /**
   * Fires once, at most, when the reconnect loop exhausts its attempts
   * without ever having connected — the signal that the server likely
   * failed to start (as opposed to a connection dropping mid-session).
   * Not called for drops after a successful initial connect.
   */
  onNeverConnected?: () => void;
  /** See {@link FailureListener}. Absent means always `'retry'`. */
  onFailure?: FailureListener;
}

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
    private readonly options: WsClientOptions = {},
  ) {}

  /**
   * Open the connection (or start reconnect loop). A no-op while a socket is
   * already open or connecting, so callers never end up with two.
   */
  connect(): void {
    if (this.disposed || this.ws !== null) {
      return;
    }
    this.clearReconnectTimer();
    this.attempts++;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    let opened = false;

    ws.on('open', () => {
      opened = true;
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
      if (this.ws === ws) {
        this.ws = null;
      }
      this.onStatus(false);
      void this.afterFailure(opened);
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
    this.clearReconnectTimer();
    this.ws?.close();
    this.ws = null;
  }

  /**
   * Give the next {@link connect} call a fresh reconnect budget and re-arm
   * {@link WsClientOptions.onNeverConnected}. Used by a caller (re)launching
   * the server, so the attempt to reach it gets the full attempt count rather
   * than immediately re-exhausting whatever was left over — and so a server
   * that never comes up is reported as such even if an earlier one connected.
   */
  resetAttempts(): void {
    this.attempts = 0;
    this.everConnected = false;
  }

  /**
   * If not connected or connecting, try again right now with a fresh backoff
   * — also after the loop has given up. For a caller that has just learned the
   * server is reachable again (e.g. the window's control connection opened).
   */
  reconnectNow(): void {
    if (this.disposed || this.ws !== null) {
      return;
    }
    this.attempts = 0;
    this.connect();
  }

  private async afterFailure(wasOpen: boolean): Promise<void> {
    if (this.disposed) {
      return;
    }
    let verdict: FailureVerdict = 'retry';
    if (this.options.onFailure) {
      try {
        verdict = await this.options.onFailure(wasOpen);
      } catch {
        verdict = 'retry';
      }
    }
    // A socket opened meanwhile means the owner already reconnected.
    if (this.disposed || verdict === 'stop' || this.ws !== null) {
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }
    if (!this.everConnected && this.attempts >= MAX_RECONNECT_ATTEMPTS) {
      this.options.onNeverConnected?.();
      return;
    }
    const delay = this.everConnected
      ? Math.min(RECONNECT_DELAY_MS * 2 ** Math.max(0, this.attempts - 1), MAX_RECONNECT_DELAY_MS)
      : RECONNECT_DELAY_MS;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
