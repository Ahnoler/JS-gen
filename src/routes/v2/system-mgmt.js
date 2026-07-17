/**
 * 系统管理 API
 * type: 0=系统 1=模块 2=功能
 *
 * 1. GET    /api/v2/system-mgmt/tree
 * 2. CRUD   /api/v2/system-mgmt/nodes[/:id]
 * 3. GET    /api/v2/system-mgmt/search?q=
 * 4. POST   /api/v2/system-mgmt/import
 * 5. GET    /api/v2/system-mgmt/export
 * 6. GET    /api/v2/system-mgmt/template
 */
import * as hierarchyService from '../../services/hierarchy-service.js';
import { NODE_TYPE, TYPE_LABEL } from '../../models/hierarchy-constants.js';

function httpError(err) {
  if (err.code === 'SEED_PROTECTED' || err.code === 'VALIDATION') return 400;
  if (err.code === 'NOT_FOUND') return 404;
  return 500;
}

export default function (app) {
  /** 1. 整树 */
  app.get('/api/v2/system-mgmt/tree', async (req, res) => {
    try {
      const includeAccounts = req.query.accounts !== '0' && req.query.accounts !== 'false';
      const tree = await hierarchyService.getTree({ includeAccounts });
      res.json({
        typeMap: TYPE_LABEL,
        count: tree.length,
        tree,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** 6. 模板（放在 :id 之前） */
  app.get('/api/v2/system-mgmt/template', (_req, res) => {
    res.json(hierarchyService.getTreeTemplate());
  });

  /** 5. 导出 */
  app.get('/api/v2/system-mgmt/export', async (_req, res) => {
    try {
      const data = await hierarchyService.exportTree();
      res.setHeader('Content-Disposition', 'attachment; filename="system-tree.json"');
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** 3. 搜索 + 溯源 */
  app.get('/api/v2/system-mgmt/search', async (req, res) => {
    try {
      const q = req.query.q ?? req.query.keyword ?? '';
      const limit = +req.query.limit || 50;
      if (!String(q).trim()) {
        return res.status(400).json({ error: 'q（关键词）不能为空' });
      }
      const result = await hierarchyService.searchNodes(q, { limit });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** 4. 导入 */
  app.post('/api/v2/system-mgmt/import', async (req, res) => {
    try {
      const result = await hierarchyService.importTree(req.body || {});
      res.status(201).json(result);
    } catch (err) {
      res.status(httpError(err)).json({ error: err.message });
    }
  });

  /** 2. 列表（可选 type / parentId） */
  app.get('/api/v2/system-mgmt/nodes', async (req, res) => {
    try {
      const { type, parentId } = req.query;
      const rows = await hierarchyService.listNodes({
        type: type !== undefined ? type : undefined,
        parentId: parentId !== undefined ? parentId : undefined,
      });
      res.json({ typeMap: TYPE_LABEL, count: rows.length, rows });
    } catch (err) {
      res.status(httpError(err)).json({ error: err.message });
    }
  });

  /** 2. 详情 */
  app.get('/api/v2/system-mgmt/nodes/:id', async (req, res) => {
    try {
      const node = await hierarchyService.getNode(+req.params.id);
      if (!node) return res.status(404).json({ error: '节点不存在' });
      res.json(node);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** 2. 新增 — body: { type, parentId?, name, description?, sortOrder? } */
  app.post('/api/v2/system-mgmt/nodes', async (req, res) => {
    try {
      const body = req.body || {};
      if (body.type === undefined || body.type === null || body.type === '') {
        return res.status(400).json({ error: 'type 必填：0=系统 1=模块 2=功能' });
      }
      const node = await hierarchyService.createNode({
        type: +body.type,
        parentId: body.parentId != null && body.parentId !== '' ? +body.parentId : null,
        name: body.name,
        description: body.description,
        sortOrder: body.sortOrder,
        systemId: body.uid || body.systemId,
      });
      res.status(201).json(node);
    } catch (err) {
      res.status(httpError(err)).json({ error: err.message });
    }
  });

  /** 2. 修改 */
  app.put('/api/v2/system-mgmt/nodes/:id', async (req, res) => {
    try {
      const node = await hierarchyService.updateNode(+req.params.id, req.body || {});
      if (!node) return res.status(404).json({ error: '节点不存在' });
      res.json(node);
    } catch (err) {
      res.status(httpError(err)).json({ error: err.message });
    }
  });

  /** 2. 删除（级联子节点） */
  app.delete('/api/v2/system-mgmt/nodes/:id', async (req, res) => {
    try {
      const existing = await hierarchyService.getNode(+req.params.id);
      if (!existing) return res.status(404).json({ error: '节点不存在' });
      await hierarchyService.deleteNode(+req.params.id);
      res.json({ status: 'deleted', id: +req.params.id, type: existing.type });
    } catch (err) {
      res.status(httpError(err)).json({ error: err.message });
    }
  });

  // expose constants for clients
  app.get('/api/v2/system-mgmt/meta', (_req, res) => {
    res.json({
      typeMap: TYPE_LABEL,
      types: [
        { type: NODE_TYPE.SYSTEM, label: '系统' },
        { type: NODE_TYPE.MODULE, label: '模块' },
        { type: NODE_TYPE.FUNCTION, label: '功能' },
      ],
    });
  });
}
