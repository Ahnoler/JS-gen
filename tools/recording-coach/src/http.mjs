/**
 * Thin HTTP client for JS-gen control plane /api/v2.
 */

export function createClient({ baseUrl = process.env.JSGEN_BASE_URL || 'http://127.0.0.1:4097' } = {}) {
  const root = String(baseUrl).replace(/\/$/, '');

  async function request(method, apiPath, body, { timeoutMs = 120_000 } = {}) {
    const url = apiPath.startsWith('http') ? apiPath : `${root}${apiPath}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`non-JSON ${res.status} from ${url}: ${text.slice(0, 200)}`);
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 400)}`);
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    baseUrl: root,
    get: (p, opts) => request('GET', p, undefined, opts),
    post: (p, body, opts) => request('POST', p, body ?? {}, opts),
  };
}

export function unwrap(json) {
  if (json && typeof json === 'object' && 'data' in json && json.code != null) {
    return json.data;
  }
  return json;
}
