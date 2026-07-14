/**
 * Legacy JSON case-data catalog — OFFLINE.
 * Use /api/v2/case-data instead (MySQL).
 */
export default function (app) {
  const gone = (req, res) => {
    res.status(410).json({
      error: 'This endpoint has been removed. Use /api/v2/case-data',
      migratedTo: '/api/v2/case-data',
    });
  };
  app.get('/api/case-data', gone);
  app.get('/api/case-data/:recordId', gone);
  app.get('/api/case-data/:recordId/file', gone);
  app.delete('/api/case-data/:recordId', gone);
}
