/**
 * Unified product API response envelope for /api/v2/*
 *
 * Success: { code: 0, message: "ok", data: <payload> }
 * Failure: { code: <httpStatus>, message: "<reason>", data: null | extra }
 *
 * HTTP status still reflects success/error (201 create, 4xx/5xx fail).
 * code === 0 means business success; non-zero mirrors HTTP status on errors.
 */

export const OK_CODE = 0;

export function okBody(data = null, message = 'ok') {
  return { code: OK_CODE, message, data };
}

export function failBody(code, message, data = null) {
  return { code, message: message || 'error', data };
}

/** Explicit helpers when a route wants to send the envelope directly. */
export function sendOk(res, data = null, { status = 200, message = 'ok' } = {}) {
  return res.status(status).json(okBody(data, message));
}

export function sendFail(res, code, message, data = null) {
  const status = Number(code) >= 100 && Number(code) < 600 ? Number(code) : 500;
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
 * Express middleware: wrap all res.json() under /api/v2 into the envelope.
 * Skip double-wrap; convert legacy `{ error }` to fail envelope.
 */
export function v2ResponseEnvelope(_req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    if (looksLikeEnvelope(body)) {
      return originalJson(body);
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
      // Unusual: error status with non-error body
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
