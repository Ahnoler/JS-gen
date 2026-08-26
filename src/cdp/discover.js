/**
 * Probe Chrome remote-debugging HTTP endpoints for CDP WebSocket URL.
 * browser_use default port is 9242; also try common 9222.
 * Prefer an explicit `ports` / `port` (per executor slot) to avoid the wrong Chrome.
 */
import { request } from 'undici';

const DEFAULT_PORTS = [9242, 9222, 9229];

/**
 * Probe Chrome remote-debugging HTTP endpoints for a CDP WebSocket URL.
 * @param {{ host?: string, ports?: number[] }} [opts] Discovery options.
 * @returns {Promise<{ cdpHttp: string, cdpWsUrl: string, browser: string, port: number }|null>} First live CDP endpoint, or null.
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
 * @param {{ attempts?: number, delayMs?: number, host?: string, ports?: number[], port?: number }} [opts] Retry + discovery options.
 * @returns {Promise<{ cdpHttp: string, cdpWsUrl: string, browser: string, port: number }|null>} First live CDP endpoint, or null.
 */
export async function discoverCdpWithRetry({
  attempts = 20,
  delayMs = 400,
  port,
  ports,
  ...opts
} = {}) {
  const portList = ports || (port != null && Number.isFinite(Number(port)) ? [Number(port)] : undefined);
  for (let i = 0; i < attempts; i++) {
    const hit = await discoverCdp({ ...opts, ports: portList });
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

/**
 * Probe every port in a contiguous range; return all live CDP endpoints.
 * @param {{ host?: string, portBase?: number, span?: number }} [opts] Range discovery options.
 * @returns {Promise<{ port: number, cdpHttp: string, cdpWsUrl: string, browser: string }[]>} All live CDP endpoints found in the range.
 */
export async function discoverAllCdpInRange(opts = {}) {
  const host = opts.host || '127.0.0.1';
  const portBase = Number(opts.portBase) || 19242;
  const span = Math.max(1, Number(opts.span) || 40);
  const ports = Array.from({ length: span }, (_, i) => portBase + i);
  const out = [];
  for (const port of ports) {
    const hit = await discoverCdp({ host, ports: [port] });
    if (hit) out.push(hit);
  }
  return out;
}
