/**
 * `HTTPS_PROXY` / `NO_PROXY` support for the extension's own downloads (today
 * only uv, in `uv-setup.ts`): Node's `https` ignores those variables, while
 * uv and the Python backend (urllib) honour them, so on a proxied host the
 * very first step of the bootstrap was the only one that could not get out.
 *
 * Exposed as an `https.Agent` that tunnels through the proxy with `CONNECT`.
 * Being an agent (not a pre-opened socket) matters inside VS Code: when its
 * `http.proxySupport` patching replaces a request's agent, ours is simply
 * never asked for a connection — nothing is opened twice or leaked.
 */

import * as http from 'http';
import * as https from 'https';
import type * as net from 'net';
import type * as stream from 'stream';
import * as tls from 'tls';

/** How long the proxy may take to answer `CONNECT` before we give up. */
const CONNECT_TIMEOUT_MS = 30_000;

/**
 * The proxy an `https:` request to `target` should go through per `env`, or
 * `null` for a direct connection. Lower-case names win over upper-case, as in
 * curl. `NO_PROXY` entries match the host itself or any subdomain (a leading
 * `.` is optional, ports are ignored); `*` bypasses the proxy entirely.
 */
export function proxyForUrl(target: URL, env: NodeJS.ProcessEnv): URL | null {
  const raw = env['https_proxy'] || env['HTTPS_PROXY'] || '';
  if (raw === '') {
    return null;
  }
  const host = target.hostname.toLowerCase();
  const noProxy = (env['no_proxy'] || env['NO_PROXY'] || '')
    .split(',')
    .map((e) => e.trim().toLowerCase().replace(/:\d+$/, '').replace(/^\*?\./, ''))
    .filter((e) => e !== '');
  if (noProxy.some((e) => e === '*' || host === e || host.endsWith(`.${e}`))) {
    return null;
  }
  try {
    return new URL(raw.includes('://') ? raw : `http://${raw}`);
  } catch {
    return null;
  }
}

/** An `https.Agent` whose every connection is a `CONNECT` tunnel through `proxy`. */
export class ProxyTunnelAgent extends https.Agent {
  constructor(private readonly proxy: URL) {
    super();
  }

  override createConnection(
    options: https.RequestOptions,
    callback?: (err: Error | null, stream: stream.Duplex) => void,
  ): stream.Duplex | null | undefined {
    const host = options.hostname ?? options.host ?? '';
    const port = Number(options.port ?? 443);
    const headers: http.OutgoingHttpHeaders = { Host: `${host}:${port}` };
    if (this.proxy.username !== '') {
      const creds = `${decodeURIComponent(this.proxy.username)}:${decodeURIComponent(this.proxy.password)}`;
      headers['Proxy-Authorization'] = `Basic ${Buffer.from(creds).toString('base64')}`;
    }
    const request = this.proxy.protocol === 'https:' ? https.request : http.request;
    const req = request({
      host: this.proxy.hostname,
      port: this.proxy.port || (this.proxy.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers,
      agent: false,
    });
    const fail = (err: Error): void => callback?.(err, undefined as unknown as stream.Duplex);
    req.setTimeout(CONNECT_TIMEOUT_MS, () =>
      req.destroy(new Error(`proxy ${this.proxy.host} did not answer CONNECT within ${CONNECT_TIMEOUT_MS / 1000}s`)),
    );
    req.once('connect', (res: http.IncomingMessage, socket: net.Socket) => {
      req.setTimeout(0);
      if (res.statusCode !== 200) {
        socket.destroy();
        fail(new Error(`proxy ${this.proxy.host} refused CONNECT ${host}:${port}: HTTP ${res.statusCode ?? '?'}`));
        return;
      }
      callback?.(null, tls.connect({
        socket,
        servername: options.servername || host,
        ca: options.ca,
        rejectUnauthorized: options.rejectUnauthorized,
      }));
    });
    req.once('error', fail);
    req.end();
    return undefined;
  }
}
