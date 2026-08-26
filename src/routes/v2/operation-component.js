/**
 * Operation component library APIs (Phase 1 — deposit / CRUD / mine).
 */
import * as componentService from '../../services/operation-component-service.js';
import * as mineService from '../../services/operation-component-mine-service.js';
import { sendErr, asyncHandler } from './trajectory-shared.js';

/**
 * Register operation-component library routes.
 * @param {import('express').Application} app Express application
 */
export default function registerOperationComponent(app) {
  /** Mine operation components from recorded trajectories. */
  app.post('/api/v2/operation-components/mine', asyncHandler(async (req, res) => {
    const result = await mineService.mineOperationComponents(req.body || {});
    res.json(result);
  }));

  /** List operation components (paginated/filtered). */
  app.get('/api/v2/operation-components', asyncHandler(async (req, res) => {
    const result = await componentService.listComponents(req.query);
    res.json(result);
  }));

  /** Get a single operation component by id. */
  app.get('/api/v2/operation-components/:id', asyncHandler(async (req, res) => {
    const row = await componentService.getComponent(+req.params.id);
    res.json(row);
  }));

  /** Create a new operation component. */
  app.post('/api/v2/operation-components', asyncHandler(async (req, res) => {
    const row = await componentService.createComponent(req.body || {});
    res.status(201).json(row);
  }));

  /** Update an operation component (partial). */
  app.patch('/api/v2/operation-components/:id', asyncHandler(async (req, res) => {
    const row = await componentService.updateComponent(+req.params.id, req.body || {});
    res.json(row);
  }));

  /** Confirm an operation component. */
  app.post('/api/v2/operation-components/:id/confirm', asyncHandler(async (req, res) => {
    const row = await componentService.confirmComponent(+req.params.id);
    res.json(row);
  }));

  /** Deprecate an operation component. */
  app.post('/api/v2/operation-components/:id/deprecate', asyncHandler(async (req, res) => {
    const row = await componentService.deprecateComponent(+req.params.id);
    res.json(row);
  }));

  /** Delete an operation component. */
  app.delete('/api/v2/operation-components/:id', asyncHandler(async (req, res) => {
    const result = await componentService.deleteComponent(+req.params.id);
    res.json(result);
  }));
}
