import * as assert from 'assert';
import type { AddressInfo } from 'net';
import { WebSocketServer } from 'ws';

import { WsClient, type FailureVerdict } from '../ws-client';

// WsClient's reconnect contract against a real loopback `ws` server: the
// owner's failure verdict, reconnectNow after the loop gave up, and no double
// sockets from overlapping connect() calls.

const TIMEOUT_MS = 3_000;

async function waitUntil(predicate: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for: ${what}`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function startServer(port = 0): Promise<WebSocketServer> {
  return new Promise((resolve) => {
    const server: WebSocketServer = new WebSocketServer({ host: '127.0.0.1', port }, () => resolve(server));
  });
}

function closeServer(wss: WebSocketServer): Promise<void> {
  for (const client of wss.clients) {
    client.terminate();
  }
  return new Promise((resolve) => wss.close(() => resolve()));
}

suite('ws-client', () => {
  let wss: WebSocketServer;
  let url: string;
  const clients: WsClient[] = [];

  setup(async () => {
    wss = await startServer();
    url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
  });

  teardown(async () => {
    for (const c of clients.splice(0)) {
      c.dispose();
    }
    await closeServer(wss);
  });

  function client(onFailure?: (wasOpen: boolean) => FailureVerdict): { ws: WsClient; statuses: boolean[] } {
    const statuses: boolean[] = [];
    const ws = new WsClient(url, () => undefined, (c) => statuses.push(c), { onFailure });
    clients.push(ws);
    return { ws, statuses };
  }

  test('a drop is reported to onFailure as wasOpen=true', async () => {
    const verdicts: boolean[] = [];
    const { ws, statuses } = client((wasOpen) => {
      verdicts.push(wasOpen);
      return 'stop';
    });
    ws.connect();
    await waitUntil(() => statuses.includes(true), 'open');

    for (const c of wss.clients) {
      c.terminate();
    }
    await waitUntil(() => verdicts.length === 1, 'failure verdict');
    assert.deepStrictEqual(verdicts, [true]);
  });

  test("a 'stop' verdict ends the loop; connect() restarts it", async function () {
    this.timeout(10_000); // waits out one 2 s reconnect delay
    const verdicts: boolean[] = [];
    const { ws, statuses } = client((wasOpen) => {
      verdicts.push(wasOpen);
      return 'stop';
    });
    const port = (wss.address() as AddressInfo).port;
    await closeServer(wss);

    ws.connect();
    await waitUntil(() => verdicts.length === 1, 'first failure');
    assert.deepStrictEqual(verdicts, [false]);
    await new Promise((r) => setTimeout(r, 2_300)); // past one reconnect delay
    assert.strictEqual(verdicts.length, 1, 'no retry after stop');

    wss = await startServer(port);
    ws.connect();
    await waitUntil(() => statuses.includes(true), 'reconnected');
  });

  test('reconnectNow revives a loop that gave up', async () => {
    const { ws, statuses } = client(() => 'stop');
    const port = (wss.address() as AddressInfo).port;
    await closeServer(wss);
    ws.connect();
    await waitUntil(() => statuses.length === 1, 'failed attempt');

    wss = await startServer(port);
    ws.reconnectNow();
    await waitUntil(() => statuses.includes(true), 'reconnected');
  });

  test('overlapping connect() calls open a single socket', async () => {
    const { ws, statuses } = client();
    ws.connect();
    ws.connect();
    ws.reconnectNow();
    await waitUntil(() => statuses.includes(true), 'open');
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(wss.clients.size, 1);
  });
});
