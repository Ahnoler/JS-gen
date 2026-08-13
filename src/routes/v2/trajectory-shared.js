/** Shared small helpers for the v2 trajectory route modules. */
export function sendErr(res, err, fallback = 500) {
  const status = err.statusCode || fallback;
  const body = { error: err.message };
  if (err.code) body.code = err.code;
  if (err.ownerTrajectoryId != null) body.ownerTrajectoryId = err.ownerTrajectoryId;
  if (err.graceUntil != null) body.graceUntil = err.graceUntil;
  if (err.holders) body.holders = err.holders;
  if (err.rejected) body.rejected = err.rejected;
  res.status(status).json(body);
}

/**
 * Wrap an async Express handler; any rejection → sendErr (same error shape as
 * the hand-written try/catch it replaces). Async passthrough: awaits fn.
 */
export function asyncHandler(fn) {
  return async (req, res, next) => {
    try {
      return await fn(req, res, next);
    } catch (err) {
      sendErr(res, err);
    }
  };
}
