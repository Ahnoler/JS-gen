/**
 * Operation component library APIs (Phase 1 — deposit / CRUD / mine).
 */
import * as componentService from '../../services/operation-component-service.js';
import * as mineService from '../../services/operation-component-mine-service.js';
import { sendErr, asyncHandler } from './trajectory-shared.js';

export default function registerOperationComponent(app) {
  app.post('/api/v2/operation-components/mine', asyncHandler(async (req, res) => {
    const result = await mineService.mineOperationComponents(req.body || {});
    res.json(result);
  }));

  app.get('/api/v2/operation-components', asyncHandler(async (req, res) => {
    const result = await componentService.listComponents(req.query);
    res.json(result);
  }));

  app.get('/api/v2/operation-components/:id', asyncHandler(async (req, res) => {
    const row = await componentService.getComponent(+req.params.id);
    res.json(row);
  }));

  app.post('/api/v2/operation-components', asyncHandler(async (req, res) => {
    const row = await componentService.createComponent(req.body || {});
    res.status(201).json(row);
  }));

  app.patch('/api/v2/operation-components/:id', asyncHandler(async (req, res) => {
    const row = await componentService.updateComponent(+req.params.id, req.body || {});
    res.json(row);
  }));

  app.post('/api/v2/operation-components/:id/confirm', asyncHandler(async (req, res) => {
    const row = await componentService.confirmComponent(+req.params.id);
    res.json(row);
  }));

  app.post('/api/v2/operation-components/:id/deprecate', asyncHandler(async (req, res) => {
    const row = await componentService.deprecateComponent(+req.params.id);
    res.json(row);
  }));

  app.delete('/api/v2/operation-components/:id', asyncHandler(async (req, res) => {
    const result = await componentService.deleteComponent(+req.params.id);
    res.json(result);
  }));
}
