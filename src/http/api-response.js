/**
 * Unified product API response envelope for /api/v2/*
 *
 * Business `code` buckets (body):
 *   200     — 成功
 *   4**     — 鉴权失败（401 / 403）
 *   5**     — 错误（含原 400/404/409 等非鉴权失败，统一落在 5xx）
 *
 * HTTP status may still use fine-grained 201/400/404 for transport;
 * the JSON `code` is what product clients should branch on.
 */

/** Product success business code. */
export const OK_CODE = 200;

/** Auth-failure HTTP statuses → body code stays in 4xx. */
const AUTH_CODES = new Set([401, 403]);

/**
 * Map an HTTP status to the product business code.
 * @param {number} httpStatus http status
 * @returns {number} result
 */
export function toBusinessCode(httpStatus) {
  const s = Number(httpStatus);
  if (!Number.isFinite(s) || s < 400) return OK_CODE;
  if (AUTH_CODES.has(s)) return s;
  if (s >= 500 && s < 600) return s;
  // 400 / 404 / 409 / 422 … → 业务「错误」
  return 500;
}

/**
 * Build a success envelope body.
 * @param {unknown} [data] payload data
 * @param {string} [message] human-readable message
 * @returns {{ code: number, message: string, data: unknown }} success envelope body
 */
export function okBody(data = null, message = 'ok') {
  return { code: OK_CODE, message, data };
}

/**
 * Build a failure envelope body mapped from an HTTP status.
 * @param {number} httpStatus http status
 * @param {string} [message] message
 * @param {unknown} [data] data
 * @returns {{ code: number, message: string, data: unknown }} failure envelope body
 */
export function failBody(httpStatus, message, data = null) {
  return {
    code: toBusinessCode(httpStatus),
    message: message || 'error',
    data,
  };
}

/**
 * Send a success envelope directly via res.json().
 * @param {import('express').Response} res res
 * @param {unknown} [data] data
 * @param {{ status?: number, message?: string }} [opts] opts
 * @returns {import('express').Response} result
 */
export function sendOk(res, data = null, { status = 200, message = 'ok' } = {}) {
  return res.status(status).json(okBody(data, message));
}

/**
 * Send a failure envelope directly via res.json().
 * @param {import('express').Response} res res
 * @param {number} httpStatus http status
 * @param {string} [message] message
 * @param {unknown} [data] data
 * @returns {import('express').Response} result
 */
export function sendFail(res, httpStatus, message, data = null) {
  const status = Number(httpStatus) >= 100 && Number(httpStatus) < 600
    ? Number(httpStatus)
    : 500;
  return res.status(status).json(failBody(status, message, data));
}

function looksLikeEnvelope(body) {
  return (
    body != null
    && typeof body === 'object'
    && !Array.isArray(body)
    && Object.prototype.hasOwnProperty.call(body, 'code')
    && Object.prototype.hasOwnProperty.call(body, 'data')
  );
}

function looksLikeLegacyError(body) {
  return (
    body != null
    && typeof body === 'object'
    && !Array.isArray(body)
    && typeof body.error === 'string'
    && !looksLikeEnvelope(body)
  );
}

/**
 * If a route already sent an envelope, re-normalize `code` to product buckets
 * (e.g. raw code 404 → 500) unless it is already 200 / 401 / 403 / 5xx.
 * @param {object} body response body to normalize
 * @returns {object} normalized envelope body with product-compliant code
 */
function normalizeEnvelope(body) {
  if (!looksLikeEnvelope(body)) return body;
  const next = toBusinessCode(body.code);
  if (next === body.code) return body;
  return { ...body, code: next };
}

/**
 * Express middleware: wrap all res.json() under /api/v2 into the product envelope.
 * Skips double-wrap; converts legacy `{ error }` bodies to fail envelopes.
 * @param {import('express').Request} _req _req
 * @param {import('express').Response} res res
 * @param {import('express').NextFunction} next next
 * @returns {void} result
 */
export function v2ResponseEnvelope(_req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    if (looksLikeEnvelope(body)) {
      return originalJson(normalizeEnvelope(body));
    }

    if (looksLikeLegacyError(body)) {
      const status = res.statusCode >= 400 ? res.statusCode : 500;
      const { error, ...rest } = body;
      const extraKeys = Object.keys(rest);
      const data = extraKeys.length ? rest : null;
      return originalJson(failBody(status, error, data));
    }

    const status = res.statusCode || 200;
    if (status >= 400) {
      const message =
        (body && typeof body === 'object' && (body.message || body.error))
        || res.statusMessage
        || 'error';
      return originalJson(failBody(status, String(message), body ?? null));
    }

    return originalJson(okBody(body === undefined ? null : body));
  };

  next();
}
