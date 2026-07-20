/**
 * Self-use trajectory recording console — API helpers.
 * Product /api/v2 responses: { code, message, data }
 */
import { unwrapApi, apiErrorMessage, isApiFail } from '../api-envelope.js';

export { unwrapApi };

export async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (isApiFail(res, json)) {
    const err = new Error(apiErrorMessage(json, res.statusText || String(res.status)));
    err.status = res.status;
    err.code = json.code;
    err.body = json;
    throw err;
  }

  return unwrapApi(json);
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
