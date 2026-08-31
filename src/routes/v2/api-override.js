import * as apiOverrideService from '../../services/api-override-service.js';
import { asyncHandler, AppError } from '../../http/app-error.js';

/**
 * API override (CDP Fetch interception) rule CRUD — list, get, create, update,
 * delete, and applicable-resolution for the CDP Fetch runtime.
 *
 * Prefix: /api/v2/api-overrides/*
 * @param {import('express').Application} app Express application
 */
export default function (app) {
  /** List API override rules (paginated, optional enabled/scope filter). */
  app.get('/api/v2/api-overrides', asyncHandler(async (req, res) => {
    const { enabled, scope, scopeRefId, page, pageSize } = req.query;
    const result = await apiOverrideService.listOverrides({
      enabled: enabled === undefined ? undefined : enabled === 'true' || enabled === '1',
      scope,
      scopeRefId: scopeRefId != null ? +scopeRefId : undefined,
      page: +page || 1,
      pageSize: +pageSize || 50,
    });
    res.json(result);
  }));

  /** Resolve enabled overrides for a scope hierarchy (for CDP Fetch runtime). */
  app.get('/api/v2/api-overrides/applicable', asyncHandler(async (req, res) => {
    const { scope, scopeRefId } = req.query;
    const list = await apiOverrideService.listApplicableOverrides({
      scope: scope || 'global',
      scopeRefId: scopeRefId != null ? +scopeRefId : null,
    });
    res.json(list);
  }));

  /** Get a single API override rule by id. */
  app.get('/api/v2/api-overrides/:id', asyncHandler(async (req, res) => {
    const rule = await apiOverrideService.getOverride(+req.params.id);
    if (!rule) return res.status(404).json({ error: 'Api override not found' });
    res.json(rule);
  }));

  /** Create a new API override rule. */
  app.post('/api/v2/api-overrides', asyncHandler(async (req, res) => {
    let rule;
    try {
      rule = await apiOverrideService.createOverride(req.body || {});
    } catch (err) {
      // Preserve legacy 400-on-validation-message mapping
      throw new AppError(err.message, {
        status: /required|Invalid/.test(err.message) ? 400 : 500,
      });
    }
    res.status(201).json(rule);
  }));

  /** Update an existing API override rule. */
  app.put('/api/v2/api-overrides/:id', asyncHandler(async (req, res) => {
    let rule;
    try {
      rule = await apiOverrideService.updateOverride(+req.params.id, req.body || {});
    } catch (err) {
      // Preserve legacy 400-on-validation-message mapping
      throw new AppError(err.message, {
        status: /required|Invalid/.test(err.message) ? 400 : 500,
      });
    }
    if (!rule) return res.status(404).json({ error: 'Api override not found' });
    res.json(rule);
  }));

  /** Delete an API override rule. */
  app.delete('/api/v2/api-overrides/:id', asyncHandler(async (req, res) => {
    await apiOverrideService.removeOverride(+req.params.id);
    res.json({ status: 'deleted' });
  }));
}
