import * as http from 'node:http';
import * as https from 'node:https';

export interface McpHttpResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  headers?: { get?: (name: string) => string | null };
  text?: () => Promise<string>;
}

/**
 * POST via node http(s).request — does not use HTTP_PROXY/http_proxy, so MCP URLs are not
 * routed through a local proxy (common cause of ECONNREFUSED 127.0.0.1:<mcp-port>).
 */
export function mcpDirectHttpPost(
  urlStr: string,
  hdrs: Record<string, string>,
  body: string,
  signal?: AbortSignal | null,
): Promise<McpHttpResponseLike> {
  const url = new URL(urlStr);
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;
  const defaultPort = isHttps ? 443 : 80;
  const port = url.port ? parseInt(url.port, 10) : defaultPort;

  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      req.destroy();
      settle(() => reject(new DOMException('The operation was aborted.', 'AbortError')));
    };
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      fn();
    };

    let req!: http.ClientRequest;
    req = lib.request(
      {
        hostname: url.hostname,
        port,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: hdrs,
        timeout: 120_000,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (c: Buffer) => chunks.push(c));
        incoming.on('end', () => {
          settle(() => {
            const raw = Buffer.concat(chunks).toString('utf8');
            const h = incoming.headers;
            resolve({
              ok: incoming.statusCode != null && incoming.statusCode >= 200 && incoming.statusCode < 300,
              status: incoming.statusCode ?? 0,
              statusText: incoming.statusMessage ?? '',
              headers: {
                get: (name: string) => {
                  const v = h[name.toLowerCase()];
                  if (Array.isArray(v)) return v[0] ?? null;
                  return v ?? null;
                },
              },
              text: async () => raw,
            });
          });
        });
        incoming.on('error', (err) => settle(() => reject(err)));
      },
    );

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    req.on('error', (err) => settle(() => reject(err)));
    req.write(body);
    req.end();
  });
}
