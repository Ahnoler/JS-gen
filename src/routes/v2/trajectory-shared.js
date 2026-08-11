/** Shared small helpers for the v2 trajectory route modules. */
export function sendErr(res, err, fallback = 500) {
  const status = err.statusCode || fallback;
  const body = { error: err.message };
  if (err.code) body.code = err.code;
  if (err.ownerTrajectoryId != null) body.ownerTrajectoryId = err.ownerTrajectoryId;
  if (err.graceUntil != null) body.graceUntil = err.graceUntil;
  if (err.holders) body.holders = err.holders;
  res.status(status).json(body);
}
