/**
 * Legacy JSON trajectory catalog — OFFLINE.
 * Use /api/v2/trajectories instead (MySQL).
 */
export default function (app) {
  const gone = (req, res) => {
    res.status(410).json({
      error: 'This endpoint has been removed. Use /api/v2/trajectories',
      migratedTo: '/api/v2/trajectories',
    });
  };
  app.get('/api/trajectory', gone);
  app.get('/api/trajectory/:trajectoryId', gone);
  app.delete('/api/trajectory/:trajectoryId', gone);
}
