/**
 * Register 410 Gone stubs for legacy JSON catalog paths.
 * @param {import('express').Application} app Express application
 * @param {string} basePath e.g. '/api/trajectory'
 * @param {string} migratedTo e.g. '/api/v2/trajectories'
 * @param {string[]} [extraSuffixes] e.g. ['/:id/file']
 */
export function registerGoneCatalog(app, basePath, migratedTo, extraSuffixes = []) {
  const gone = (_req, res) => {
    res.status(410).json({
      error: `This endpoint has been removed. Use ${migratedTo}`,
      migratedTo,
    });
  };
  app.get(basePath, gone);
  app.get(`${basePath}/:id`, gone);
  app.delete(`${basePath}/:id`, gone);
  for (const suffix of extraSuffixes) {
    app.get(`${basePath}${suffix}`, gone);
  }
}

/**
 * Register 410 Gone stubs for all legacy catalog paths (/api/trajectory,
 * /api/case-data) pointing to their v2 migrations.
 * @param {import('express').Application} app Express application
 */
export default function registerLegacyGoneRoutes(app) {
  registerGoneCatalog(app, '/api/trajectory', '/api/v2/trajectories');
  registerGoneCatalog(app, '/api/case-data', '/api/v2/business-data', ['/:id/file']);
}
