import * as apiOverrideService from '../../services/api-override-service.js';

/**
 * API override (CDP Fetch interception) rule CRUD — list, get, create, update,
 * delete, and applicable-resolution for the CDP Fetch runtime.
 *
 * Prefix: /api/v2/api-overrides/*
 * @param {import('express').Application} app Express application
 */
export default function (app) {
  /** List API override rules (paginated, optional enabled/scope filter). */
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

  /** Get a single API override rule by id. */
  app.get('/api/v2/api-overrides/:id', async (req, res) => {
    try {
      const rule = await apiOverrideService.getOverride(+req.params.id);
      if (!rule) return res.status(404).json({ error: 'Api override not found' });
      res.json(rule);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Create a new API override rule. */
  app.post('/api/v2/api-overrides', async (req, res) => {
    try {
      const rule = await apiOverrideService.createOverride(req.body || {});
      res.status(201).json(rule);
    } catch (err) {
      const status = /required|Invalid/.test(err.message) ? 400 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  /** Update an existing API override rule. */
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

  /** Delete an API override rule. */
  app.delete('/api/v2/api-overrides/:id', async (req, res) => {
    try {
      await apiOverrideService.removeOverride(+req.params.id);
      res.json({ status: 'deleted' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
