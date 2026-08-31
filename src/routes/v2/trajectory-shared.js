/**
 * Shared small helpers for the v2 trajectory route modules.
 *
 * sendErr / asyncHandler 已收敛为 `src/http/app-error.js` 的薄委托：
 * 单源为 respondError / asyncHandler（AppError 单点映射表）。
 * 兼容性说明：sendErr 保留遗留 status 语义 `err.statusCode || fallback`
 * （默认 500），通过 respondError 的 options.status 显式传入，保证只有
 * `err.status` 而无 `err.statusCode` 的错误仍走 fallback，而非被
 * toAppError 推导为 err.status——对 5 个消费文件行为完全不变。
 */
import { respondError, asyncHandler as appAsyncHandler } from '../../http/app-error.js';

/**
 * Render an error response (thin delegate to respondError in app-error.js).
 * @param {import('express').Response} res Express response
 * @param {Error & { statusCode?: number, code?: string, ownerTrajectoryId?: number, graceUntil?: number, holders?: unknown, rejected?: unknown }} err error
 * @param {number} [fallback] fallback HTTP status (defaults to 500)
 * @returns {import('express').Response} res
 */
export function sendErr(res, err, fallback = 500) {
  return respondError(res, err, { status: err.statusCode || fallback });
}

/**
 * Wrap an async Express handler; any rejection → respondError via the
 * app-error.js asyncHandler (same error shape as sendErr). Async passthrough: awaits fn.
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<unknown>} fn async route handler
 * @returns {(req: import('express').Response, res: import('express').Response, next: import('express').NextFunction) => Promise<void>} wrapped handler
 */
export function asyncHandler(fn) {
  return appAsyncHandler(fn);
}
