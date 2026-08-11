/** Shared small helpers for the v2 trajectory route modules. */
export function sendErr(res, err, fallback = 500) {
  const status = err.statusCode || fallback;
  const body = { error: err.message };
  if (err.holders) body.holders = err.holders;
  res.status(status).json(body);
}
