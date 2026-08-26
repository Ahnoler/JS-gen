import * as systemDao from '../../dao/system-dao.js';
import * as hierarchyService from '../../services/hierarchy-service.js';
import * as systemAccountService from '../../services/system-account-service.js';
import { NODE_TYPE } from '../../models/hierarchy-constants.js';

/**
 * System / process / function hierarchy CRUD + system-account management and
 * tree retrieval.
 *
 * Prefix: /api/v2/systems/*, /api/v2/processes/*, /api/v2/functions/*, /api/v2/system-accounts/*, /api/v2/hierarchy/*
 * @param {import('express').Application} app Express application
 */
export default function (app) {
  // ── Systems (type=1) ──
  /** List all systems (hierarchy node type=1). */
  app.get('/api/v2/systems', async (req, res) => {
    try {
      res.json(await systemDao.list());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Create a new system (name, description, url). */
  app.post('/api/v2/systems', async (req, res) => {
    try {
      const { name, description, url } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name is required' });
      const system = await hierarchyService.createSystem(name, description, url);
      res.status(201).json(system);
    } catch (err) {
      const status = err.code === 'VALIDATION' ? 400 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  /** Get a single system by id. */
  app.get('/api/v2/systems/:id', async (req, res) => {
    try {
      const system = await systemDao.getById(+req.params.id);
      if (!system || system.type !== NODE_TYPE.SYSTEM) {
        return res.status(404).json({ error: 'System not found' });
      }
      res.json(system);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Update a system (name, description, url). */
  app.put('/api/v2/systems/:id', async (req, res) => {
    try {
      const existing = await systemDao.getById(+req.params.id);
      if (!existing || existing.type !== NODE_TYPE.SYSTEM) {
        return res.status(404).json({ error: 'System not found' });
      }
      const { name, description, url } = req.body || {};
      const system = await hierarchyService.updateSystem(+req.params.id, { name, description, url });
      res.json(system);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Delete a system by id (seed-protected systems rejected). */
  app.delete('/api/v2/systems/:id', async (req, res) => {
    try {
      const existing = await systemDao.getById(+req.params.id);
      if (!existing || existing.type !== NODE_TYPE.SYSTEM) {
        return res.status(404).json({ error: 'System not found' });
      }
      await systemDao.remove(+req.params.id);
      res.json({ status: 'deleted' });
    } catch (err) {
      if (err.code === 'SEED_PROTECTED') return res.status(400).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── System accounts ──
  /** List accounts for a system. */
  app.get('/api/v2/systems/:systemId/accounts', async (req, res) => {
    try {
      res.json(await systemAccountService.listBySystem(+req.params.systemId));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Create a system account (login credentials for the target system). */
  app.post('/api/v2/systems/:systemId/accounts', async (req, res) => {
    try {
      const account = await systemAccountService.createAccount(+req.params.systemId, req.body || {});
      res.status(201).json(account);
    } catch (err) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'VALIDATION' ? 400 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  /** Get a single system account by id. */
  app.get('/api/v2/system-accounts/:id', async (req, res) => {
    try {
      const account = await systemAccountService.getAccount(+req.params.id);
      if (!account) return res.status(404).json({ error: 'Account not found' });
      res.json(account);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Update a system account. */
  app.put('/api/v2/system-accounts/:id', async (req, res) => {
    try {
      const account = await systemAccountService.updateAccount(+req.params.id, req.body || {});
      if (!account) return res.status(404).json({ error: 'Account not found' });
      res.json(account);
    } catch (err) {
      const status = err.code === 'VALIDATION' ? 400 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  /** Delete a system account. */
  app.delete('/api/v2/system-accounts/:id', async (req, res) => {
    try {
      await systemAccountService.removeAccount(+req.params.id);
      res.json({ status: 'deleted' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Processes / Modules (type=2) ──
  /** List processes (modules) under a system. */
  app.get('/api/v2/systems/:systemId/processes', async (req, res) => {
    try {
      res.json(await systemDao.listProcesses(+req.params.systemId));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Create a process (module) under a system. */
  app.post('/api/v2/systems/:systemId/processes', async (req, res) => {
    try {
      const { name, description, sortOrder } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name is required' });
      const process = await hierarchyService.createProcess(+req.params.systemId, name, description, sortOrder);
      res.status(201).json(process);
    } catch (err) {
      const status = err.code === 'VALIDATION' || err.code === 'NOT_FOUND' ? 400 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  /** Update a process (module). */
  app.put('/api/v2/processes/:id', async (req, res) => {
    try {
      const existing = await systemDao.getById(+req.params.id);
      if (!existing || existing.type !== NODE_TYPE.MODULE) {
        return res.status(404).json({ error: 'Process not found' });
      }
      const process = await systemDao.update(+req.params.id, req.body || {});
      res.json(process);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Delete a process (module) by id. */
  app.delete('/api/v2/processes/:id', async (req, res) => {
    try {
      const existing = await systemDao.getById(+req.params.id);
      if (!existing || existing.type !== NODE_TYPE.MODULE) {
        return res.status(404).json({ error: 'Process not found' });
      }
      await systemDao.remove(+req.params.id);
      res.json({ status: 'deleted' });
    } catch (err) {
      if (err.code === 'SEED_PROTECTED') return res.status(400).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── Functions (type=3) ──
  /** List functions under a process. */
  app.get('/api/v2/processes/:processId/functions', async (req, res) => {
    try {
      res.json(await systemDao.listFunctions(+req.params.processId));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Create a function under a process. */
  app.post('/api/v2/processes/:processId/functions', async (req, res) => {
    try {
      const { name, description, sortOrder } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name is required' });
      const fn = await hierarchyService.createFunction(+req.params.processId, name, description, sortOrder);
      res.status(201).json(fn);
    } catch (err) {
      const status = err.code === 'VALIDATION' || err.code === 'NOT_FOUND' ? 400 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  /** Update a function. */
  app.put('/api/v2/functions/:id', async (req, res) => {
    try {
      const existing = await systemDao.getById(+req.params.id);
      if (!existing || existing.type !== NODE_TYPE.FUNCTION) {
        return res.status(404).json({ error: 'Function not found' });
      }
      const fn = await systemDao.update(+req.params.id, req.body || {});
      res.json(fn);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Delete a function by id. */
  app.delete('/api/v2/functions/:id', async (req, res) => {
    try {
      const existing = await systemDao.getById(+req.params.id);
      if (!existing || existing.type !== NODE_TYPE.FUNCTION) {
        return res.status(404).json({ error: 'Function not found' });
      }
      await systemDao.remove(+req.params.id);
      res.json({ status: 'deleted' });
    } catch (err) {
      if (err.code === 'SEED_PROTECTED') return res.status(400).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── Tree ──
  /** Get the full system/process/function hierarchy tree. */
  app.get('/api/v2/hierarchy/tree', async (req, res) => {
    try {
      res.json(await hierarchyService.getTree());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
