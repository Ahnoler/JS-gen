import * as systemDao from '../../dao/system-dao.js';
import * as processDao from '../../dao/process-dao.js';
import * as functionDefDao from '../../dao/function-def-dao.js';
import * as hierarchyService from '../../services/hierarchy-service.js';
import * as trajectoryDao from '../../dao/trajectory-dao.js';

export default function (app) {
  // ── Systems ──
  app.get('/api/v2/systems', async (req, res) => {
    try {
      const list = await systemDao.list();
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/v2/systems', async (req, res) => {
    try {
      const { name, description } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name is required' });
      const system = await hierarchyService.createSystem(name, description);
      res.status(201).json(system);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/v2/systems/:id', async (req, res) => {
    try {
      const { name, description } = req.body || {};
      const system = await systemDao.update(+req.params.id, { name, description });
      if (!system) return res.status(404).json({ error: 'System not found' });
      res.json(system);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/v2/systems/:id', async (req, res) => {
    try {
      await systemDao.remove(+req.params.id);
      res.json({ status: 'deleted' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Processes ──
  app.get('/api/v2/systems/:systemId/processes', async (req, res) => {
    try {
      const list = await processDao.listBySystem(+req.params.systemId);
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/v2/systems/:systemId/processes', async (req, res) => {
    try {
      const { name, description, sortOrder } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name is required' });
      const process = await hierarchyService.createProcess(+req.params.systemId, name, description, sortOrder);
      res.status(201).json(process);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/v2/processes/:id', async (req, res) => {
    try {
      const process = await processDao.update(+req.params.id, req.body || {});
      if (!process) return res.status(404).json({ error: 'Process not found' });
      res.json(process);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/v2/processes/:id', async (req, res) => {
    try {
      await processDao.remove(+req.params.id);
      res.json({ status: 'deleted' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Functions ──
  app.get('/api/v2/processes/:processId/functions', async (req, res) => {
    try {
      const list = await functionDefDao.listByProcess(+req.params.processId);
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/v2/processes/:processId/functions', async (req, res) => {
    try {
      const { name, description, sortOrder } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name is required' });
      const fn = await hierarchyService.createFunction(+req.params.processId, name, description, sortOrder);
      res.status(201).json(fn);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/v2/functions/:id', async (req, res) => {
    try {
      const fn = await functionDefDao.update(+req.params.id, req.body || {});
      if (!fn) return res.status(404).json({ error: 'Function not found' });
      res.json(fn);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/v2/functions/:id', async (req, res) => {
    try {
      await functionDefDao.remove(+req.params.id);
      res.json({ status: 'deleted' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Tree ──
  app.get('/api/v2/hierarchy/tree', async (req, res) => {
    try {
      const tree = await hierarchyService.getTree();
      res.json(tree);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
