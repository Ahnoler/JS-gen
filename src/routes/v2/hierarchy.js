import * as systemDao from '../../dao/system-dao.js';
import * as hierarchyService from '../../services/hierarchy-service.js';
import * as systemAccountService from '../../services/system-account-service.js';
import { NODE_TYPE } from '../../models/hierarchy-constants.js';
import { asyncHandler, AppError } from '../../http/app-error.js';

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
  app.get('/api/v2/systems', asyncHandler(async (req, res) => {
    res.json(await systemDao.list());
  }));

  /** Create a new system (name, description, url). */
  app.post('/api/v2/systems', asyncHandler(async (req, res) => {
    const { name, description, url } = req.body || {};
    if (!name) throw new AppError('name is required', { code: 'VALIDATION' });
    const system = await hierarchyService.createSystem(name, description, url);
    res.status(201).json(system);
  }));

  /** Get a single system by id. */
  app.get('/api/v2/systems/:id', asyncHandler(async (req, res) => {
    const system = await systemDao.getById(+req.params.id);
    if (!system || system.type !== NODE_TYPE.SYSTEM) {
      throw new AppError('System not found', { code: 'NOT_FOUND' });
    }
    res.json(system);
  }));

  /** Update a system (name, description, url). */
  app.put('/api/v2/systems/:id', asyncHandler(async (req, res) => {
    const existing = await systemDao.getById(+req.params.id);
    if (!existing || existing.type !== NODE_TYPE.SYSTEM) {
      throw new AppError('System not found', { code: 'NOT_FOUND' });
    }
    const { name, description, url } = req.body || {};
    const system = await hierarchyService.updateSystem(+req.params.id, { name, description, url });
    res.json(system);
  }));

  /** Delete a system by id (seed-protected systems rejected). */
  app.delete('/api/v2/systems/:id', asyncHandler(async (req, res) => {
    const existing = await systemDao.getById(+req.params.id);
    if (!existing || existing.type !== NODE_TYPE.SYSTEM) {
      throw new AppError('System not found', { code: 'NOT_FOUND' });
    }
    await systemDao.remove(+req.params.id);
    res.json({ status: 'deleted' });
  }));

  // ── System accounts ──
  /** List accounts for a system. */
  app.get('/api/v2/systems/:systemId/accounts', asyncHandler(async (req, res) => {
    res.json(await systemAccountService.listBySystem(+req.params.systemId));
  }));

  /** Create a system account (login credentials for the target system). */
  app.post('/api/v2/systems/:systemId/accounts', asyncHandler(async (req, res) => {
    const account = await systemAccountService.createAccount(+req.params.systemId, req.body || {});
    res.status(201).json(account);
  }));

  /** Get a single system account by id. */
  app.get('/api/v2/system-accounts/:id', asyncHandler(async (req, res) => {
    const account = await systemAccountService.getAccount(+req.params.id);
    if (!account) throw new AppError('Account not found', { code: 'NOT_FOUND' });
    res.json(account);
  }));

  /** Update a system account. */
  app.put('/api/v2/system-accounts/:id', asyncHandler(async (req, res) => {
    const account = await systemAccountService.updateAccount(+req.params.id, req.body || {});
    if (!account) throw new AppError('Account not found', { code: 'NOT_FOUND' });
    res.json(account);
  }));

  /** Delete a system account. */
  app.delete('/api/v2/system-accounts/:id', asyncHandler(async (req, res) => {
    await systemAccountService.removeAccount(+req.params.id);
    res.json({ status: 'deleted' });
  }));

  // ── Processes / Modules (type=2) ──
  /** List processes (modules) under a system. */
  app.get('/api/v2/systems/:systemId/processes', asyncHandler(async (req, res) => {
    res.json(await systemDao.listProcesses(+req.params.systemId));
  }));

  /** Create a process (module) under a system. */
  app.post('/api/v2/systems/:systemId/processes', asyncHandler(async (req, res) => {
    const { name, description, sortOrder } = req.body || {};
    if (!name) throw new AppError('name is required', { code: 'VALIDATION' });
    try {
      const process = await hierarchyService.createProcess(+req.params.systemId, name, description, sortOrder);
      res.status(201).json(process);
    } catch (err) {
      throw new AppError(err.message, {
        code: err.code,
        status: err.code === 'VALIDATION' || err.code === 'NOT_FOUND' ? 400 : 500,
      });
    }
  }));

  /** Update a process (module). */
  app.put('/api/v2/processes/:id', asyncHandler(async (req, res) => {
    const existing = await systemDao.getById(+req.params.id);
    if (!existing || existing.type !== NODE_TYPE.MODULE) {
      throw new AppError('Process not found', { code: 'NOT_FOUND' });
    }
    const process = await systemDao.update(+req.params.id, req.body || {});
    res.json(process);
  }));

  /** Delete a process (module) by id. */
  app.delete('/api/v2/processes/:id', asyncHandler(async (req, res) => {
    const existing = await systemDao.getById(+req.params.id);
    if (!existing || existing.type !== NODE_TYPE.MODULE) {
      throw new AppError('Process not found', { code: 'NOT_FOUND' });
    }
    await systemDao.remove(+req.params.id);
    res.json({ status: 'deleted' });
  }));

  // ── Functions (type=3) ──
  /** List functions under a process. */
  app.get('/api/v2/processes/:processId/functions', asyncHandler(async (req, res) => {
    res.json(await systemDao.listFunctions(+req.params.processId));
  }));

  /** Create a function under a process. */
  app.post('/api/v2/processes/:processId/functions', asyncHandler(async (req, res) => {
    const { name, description, sortOrder } = req.body || {};
    if (!name) throw new AppError('name is required', { code: 'VALIDATION' });
    try {
      const fn = await hierarchyService.createFunction(+req.params.processId, name, description, sortOrder);
      res.status(201).json(fn);
    } catch (err) {
      throw new AppError(err.message, {
        code: err.code,
        status: err.code === 'VALIDATION' || err.code === 'NOT_FOUND' ? 400 : 500,
      });
    }
  }));

  /** Update a function. */
  app.put('/api/v2/functions/:id', asyncHandler(async (req, res) => {
    const existing = await systemDao.getById(+req.params.id);
    if (!existing || existing.type !== NODE_TYPE.FUNCTION) {
      throw new AppError('Function not found', { code: 'NOT_FOUND' });
    }
    const fn = await systemDao.update(+req.params.id, req.body || {});
    res.json(fn);
  }));

  /** Delete a function by id. */
  app.delete('/api/v2/functions/:id', asyncHandler(async (req, res) => {
    const existing = await systemDao.getById(+req.params.id);
    if (!existing || existing.type !== NODE_TYPE.FUNCTION) {
      throw new AppError('Function not found', { code: 'NOT_FOUND' });
    }
    await systemDao.remove(+req.params.id);
    res.json({ status: 'deleted' });
  }));

  // ── Tree ──
  /** Get the full system/process/function hierarchy tree. */
  app.get('/api/v2/hierarchy/tree', asyncHandler(async (req, res) => {
    res.json(await hierarchyService.getTree());
  }));
}
