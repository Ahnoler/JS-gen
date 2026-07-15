/**
 * Probe Chrome remote-debugging HTTP endpoints for CDP WebSocket URL.
 * browser_use default port is 9242; also try common 9222.
 */
import { request } from 'undici';

const DEFAULT_PORTS = [9242, 9222, 9229];

/**
 * @param {{ host?: string, ports?: number[] }} [opts]
 * @returns {Promise<{ cdpHttp: string, cdpWsUrl: string, browser: string, port: number }|null>}
 */
export async function discoverCdp(opts = {}) {
  const host = opts.host || '127.0.0.1';
  const ports = opts.ports || DEFAULT_PORTS;

  for (const port of ports) {
    const cdpHttp = `http://${host}:${port}`;
    try {
      const res = await request(`${cdpHttp}/json/version`, {
        headersTimeout: 1500,
        bodyTimeout: 1500,
      });
      if (res.statusCode !== 200) continue;
      const body = await res.body.json();
      const cdpWsUrl = body.webSocketDebuggerUrl;
      if (!cdpWsUrl) continue;
      return {
        cdpHttp,
        cdpWsUrl,
        browser: body.Browser || '',
        port,
      };
    } catch {
      // port closed / not CDP
    }
  }
  return null;
}

/**
 * Retry discover a few times (Chrome may need a moment after Agent ready).
 */
export async function discoverCdpWithRetry({ attempts = 8, delayMs = 500, ...opts } = {}) {
  for (let i = 0; i < attempts; i++) {
    const hit = await discoverCdp(opts);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}
