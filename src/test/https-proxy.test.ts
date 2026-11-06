import * as assert from 'assert';
import * as http from 'http';
import type { AddressInfo } from 'net';

import { ProxyTunnelAgent, proxyForUrl } from '../https-proxy';

suite('https-proxy', () => {
  suite('proxyForUrl', () => {
    const target = new URL('https://github.com/astral-sh/uv/releases/download/0.13.5/uv.tar.gz');

    test('no proxy variable means a direct connection', () => {
      assert.strictEqual(proxyForUrl(target, {}), null);
    });

    test('HTTPS_PROXY without a scheme is read as http://', () => {
      assert.strictEqual(proxyForUrl(target, { HTTPS_PROXY: 'proxy.corp:3128' })?.href, 'http://proxy.corp:3128/');
    });

    test('lower-case https_proxy wins over upper-case', () => {
      const proxy = proxyForUrl(target, { https_proxy: 'http://lower:1', HTTPS_PROXY: 'http://upper:2' });
      assert.strictEqual(proxy?.hostname, 'lower');
    });

    test('NO_PROXY matches the host and its subdomains, with or without a leading dot or port', () => {
      const env = { HTTPS_PROXY: 'http://p:1' };
      for (const noProxy of ['github.com', '.github.com', 'github.com:443', 'example.org, github.com', '*']) {
        assert.strictEqual(proxyForUrl(target, { ...env, NO_PROXY: noProxy }), null, noProxy);
      }
      assert.strictEqual(proxyForUrl(new URL('https://api.github.com/x'), { ...env, no_proxy: 'github.com' }), null);
    });

    test('NO_PROXY does not match a mere suffix of another name', () => {
      assert.notStrictEqual(proxyForUrl(target, { HTTPS_PROXY: 'http://p:1', NO_PROXY: 'hub.com' }), null);
    });
  });

  suite('ProxyTunnelAgent', () => {
    // A proxy that answers every CONNECT with 407 — enough to prove the agent
    // tunnels through the proxy (with credentials) and surfaces a refusal as
    // an error instead of hanging. `createConnection` is called directly: in
    // this test host VS Code's `http.proxySupport` patch replaces the agent of
    // any `https.get`, which is the intended split in production too.
    test('sends CONNECT with proxy credentials and reports a refusal', async () => {
      const seen: { url?: string; auth?: string } = {};
      const proxy = http.createServer();
      proxy.on('connect', (req: http.IncomingMessage, socket) => {
        seen.url = req.url;
        seen.auth = req.headers['proxy-authorization'];
        socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
      });
      await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
      const { port } = proxy.address() as AddressInfo;
      try {
        const agent = new ProxyTunnelAgent(new URL(`http://us%40er:p%3Ass@127.0.0.1:${port}`));
        const err = await new Promise<Error | null>((resolve) => {
          agent.createConnection({ host: 'github.com', port: 443 }, (e, s) => {
            s?.destroy();
            resolve(e);
          });
        });
        assert.match(err?.message ?? '', /refused CONNECT github\.com:443: HTTP 407/);
        assert.strictEqual(seen.url, 'github.com:443');
        assert.strictEqual(seen.auth, `Basic ${Buffer.from('us@er:p:ss').toString('base64')}`);
      } finally {
        proxy.close();
      }
    });
  });
});
