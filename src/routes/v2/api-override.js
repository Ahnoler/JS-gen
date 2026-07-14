import * as apiOverrideService from '../../services/api-override-service.js';

export default function (app) {
  app.get('/api/v2/api-overrides', async (req, res) => {
    try {
      const { enabled, scope, scopeRefId, page, pageSize } = req.query;
      const result = await apiOverrideService.listOverrides({
        enabled: enabled === undefined ? undefined : enabled === 'true' || enabled === '1',
        scope,
        scopeRefId: scopeRefId != null ? +scopeRefId : undefined,
        page: +page || 1,
        pageSize: +pageSize || 50,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Resolve enabled overrides for a scope hierarchy (for CDP Fetch runtime). */
  app.get('/api/v2/api-overrides/applicable', async (req, res) => {
    try {
      const { scope, scopeRefId } = req.query;
      const list = await apiOverrideService.listApplicableOverrides({
        scope: scope || 'global',
        scopeRefId: scopeRefId != null ? +scopeRefId : null,
      });
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/v2/api-overrides/:id', async (req, res) => {
    try {
      const rule = await apiOverrideService.getOverride(+req.params.id);
      if (!rule) return res.status(404).json({ error: 'Api override not found' });
      res.json(rule);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/v2/api-overrides', async (req, res) => {
    try {
      const rule = await apiOverrideService.createOverride(req.body || {});
      res.status(201).json(rule);
    } catch (err) {
      const status = /required|Invalid/.test(err.message) ? 400 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  app.put('/api/v2/api-overrides/:id', async (req, res) => {
    try {
      const rule = await apiOverrideService.updateOverride(+req.params.id, req.body || {});
      if (!rule) return res.status(404).json({ error: 'Api override not found' });
      res.json(rule);
    } catch (err) {
      const status = /required|Invalid/.test(err.message) ? 400 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  app.delete('/api/v2/api-overrides/:id', async (req, res) => {
    try {
      await apiOverrideService.removeOverride(+req.params.id);
      res.json({ status: 'deleted' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
