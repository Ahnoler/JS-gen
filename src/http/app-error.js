/**
 * 统一应用错误（AppError）与异步路由错误出口（asyncHandler）。
 *
 * 错误码 → HTTP 状态由单点映射表决定：
 *   VALIDATION / SEED_PROTECTED → 400
 *   NOT_FOUND → 404
 *   CONFLICT → 409
 *   其余（含缺失码）→ 500
 *
 * 服务层遗留 statusCode 错误（尚未迁移为 AppError）以 statusCode 为准，
 * 仅在缺失时回退到单点映射表，保证迁移期间现有 HTTP 状态码不变。
 */

/** 错误码 → HTTP 状态 单点映射表（冻结，勿在模块外修改）。 */
export const ERROR_STATUS_MAP = Object.freeze({
  VALIDATION: 400,
  SEED_PROTECTED: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
});

/**
 * 由错误码推导 HTTP 状态码（单点映射表，未知/缺失 → 500）。
 * @param {string} [code] AppError 错误码
 * @returns {number} 映射后的 HTTP 状态码
 */
export function httpStatusOf(code) {
  return ERROR_STATUS_MAP[code] || 500;
}

/**
 * 统一应用错误：携带错误码 code 与 HTTP 状态 status。
 * status 默认由单点映射表推导；与表内映射不一致时可用 status 显式覆盖；
 * 响应体默认为标准体 { error: message }，需要保留既有非标准形状时传入 body。
 */
export class AppError extends Error {
  /**
   * @param {string} message 错误消息
   * @param {{ code?: string, status?: number, body?: object }} [options] 构造选项
   * @param {string} [options.code] 错误码（映射表：VALIDATION/SEED_PROTECTED→400、NOT_FOUND→404、CONFLICT→409、其余→500）
   * @param {number} [options.status] 显式 HTTP 状态码（仅在与表内映射不一致、需保留既有状态码时使用）
   * @param {object} [options.body] 自定义响应体（缺省为标准体 { error: message }）
   */
  constructor(message, { code, status, body } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status ?? httpStatusOf(code);
    if (body !== undefined) this.body = body;
  }
}

/**
 * 将任意错误归一为 AppError：已为 AppError 时原样返回。
 * 状态优先级：显式构造 status → 服务层遗留 statusCode/status → 单点映射表(code) → 500。
 * @param {unknown} err 任意错误对象
 * @returns {AppError} 归一后的 AppError
 */
export function toAppError(err) {
  if (err instanceof AppError) return err;
  return new AppError(
    (err && err.message) || 'internal error',
    {
      code: err?.code,
      status: err?.statusCode ?? err?.status,
    },
  );
}

/**
 * 渲染统一错误响应：标准体为 { error: message }，AppError.body 存在时优先使用。
 * 在缺省体（既无 options.body 也无 AppError.body）上追加错误对象携带的扩展字段：
 * code / ownerTrajectoryId / graceUntil / holders / rejected（存在且非 null 才加）。
 * 用于无法用 asyncHandler 包装的上下文（如 multer 回调）及 sendErr 薄委托。
 * @param {import('express').Response} res Express 响应对象
 * @param {unknown} err 错误对象
 * @param {{ body?: object, status?: number }} [options] 选项
 * @param {object} [options.body] 自定义响应体（与标准体不同时使用）
 * @param {number} [options.status] 显式 HTTP 状态码（覆盖推导结果；sendErr 委托时用其保留
 *   遗留 statusCode 语义，避免只有 err.status 的错误被推导为不同状态码）
 * @returns {import('express').Response} res
 */
export function respondError(res, err, { body, status } = {}) {
  const e = toAppError(err);
  if (body !== undefined) return res.status(e.status).json(body);
  if (e.body !== undefined) return res.status(e.status).json(e.body);
  const payload = { error: e.message };
  if (e.code != null) payload.code = e.code;
  if (err?.ownerTrajectoryId != null) payload.ownerTrajectoryId = err.ownerTrajectoryId;
  if (err?.graceUntil != null) payload.graceUntil = err.graceUntil;
  if (err?.holders != null) payload.holders = err.holders;
  if (err?.rejected != null) payload.rejected = err.rejected;
  return res.status(status ?? e.status).json(payload);
}

/**
 * 包装异步路由 handler：成功透传返回值；rejection 交由 respondError
 * 按 AppError 单点映射表渲染错误响应。
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<unknown>} fn 异步路由 handler
 * @returns {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<void>} 包装后的 handler
 */
export function asyncHandler(fn) {
  return async (req, res, next) => {
    try {
      return await fn(req, res, next);
    } catch (err) {
      respondError(res, err);
    }
  };
}
