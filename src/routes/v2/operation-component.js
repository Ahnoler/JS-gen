/**
 * Operation component library APIs (Phase 1 — deposit / CRUD / mine).
 */
import * as componentService from '../../services/operation-component-service.js';
import * as mineService from '../../services/operation-component-mine-service.js';

function sendErr(res, err) {
  const code = err.statusCode || 500;
  return res.status(code).json({ error: err.message });
}

export default function registerOperationComponent(app) {
  app.post('/api/v2/operation-components/mine', async (req, res) => {
    try {
      const result = await mineService.mineOperationComponents(req.body || {});
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.get('/api/v2/operation-components', async (req, res) => {
    try {
      const result = await componentService.listComponents(req.query);
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.get('/api/v2/operation-components/:id', async (req, res) => {
    try {
      const row = await componentService.getComponent(+req.params.id);
      res.json(row);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.post('/api/v2/operation-components', async (req, res) => {
    try {
      const row = await componentService.createComponent(req.body || {});
      res.status(201).json(row);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.patch('/api/v2/operation-components/:id', async (req, res) => {
    try {
      const row = await componentService.updateComponent(+req.params.id, req.body || {});
      res.json(row);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.post('/api/v2/operation-components/:id/confirm', async (req, res) => {
    try {
      const row = await componentService.confirmComponent(+req.params.id);
      res.json(row);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.post('/api/v2/operation-components/:id/deprecate', async (req, res) => {
    try {
      const row = await componentService.deprecateComponent(+req.params.id);
      res.json(row);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.delete('/api/v2/operation-components/:id', async (req, res) => {
    try {
      const result = await componentService.deleteComponent(+req.params.id);
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  });
}
