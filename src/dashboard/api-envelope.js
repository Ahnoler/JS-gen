/**
 * Client helper for product /api/v2 envelope { code, message, data }.
 *
 * code buckets: 200 成功 · 401/403 鉴权失败 · 5** 错误
 */

export function unwrapApi(json) {
  if (json == null || typeof json !== 'object') return json;
  if (Object.prototype.hasOwnProperty.call(json, 'code')
      && Object.prototype.hasOwnProperty.call(json, 'data')) {
    return json.data;
  }
  return json;
}

export function apiErrorMessage(json, fallback = 'Request failed') {
  if (!json || typeof json !== 'object') return fallback;
  return json.message || json.error || fallback;
}

export function isApiOk(json) {
  if (!json || typeof json !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(json, 'code')) return true; // bare payload
  return json.code === 200 || json.code === 0; // 0 = legacy
}

/** 401 / 403 — 鉴权失败 */
export function isAuthFail(json) {
  if (!json || typeof json !== 'object') return false;
  const c = Number(json.code);
  return c === 401 || c === 403;
}

/** 5xx — 业务错误 */
export function isBizError(json) {
  if (!json || typeof json !== 'object') return false;
  const c = Number(json.code);
  return c >= 500 && c < 600;
}

export function isApiFail(res, json) {
  if (!res.ok) return true;
  if (json && typeof json === 'object'
      && Object.prototype.hasOwnProperty.call(json, 'code')
      && !isApiOk(json)) {
    return true;
  }
  return false;
}

/** Parse v2 JSON response or throw. */
export async function readV2(res) {
  const raw = await res.json().catch(() => ({}));
  if (isApiFail(res, raw)) {
    throw new Error(apiErrorMessage(raw, `HTTP ${res.status}`));
  }
  return unwrapApi(raw);
}
