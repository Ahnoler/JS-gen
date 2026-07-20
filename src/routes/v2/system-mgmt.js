/**
 * 系统管理 API
 * type: 1=系统 2=模块 3=功能
 *
 * 响应约定（统一信封）：
 *   成功 { "code": 200, "message": "ok", "data": <payload> }
 *   鉴权失败 { "code": 401|403, "message": "<原因>", "data": null }
 *   错误 { "code": 5**, "message": "<原因>", "data": null | extra }
 * - 列表 / 树的 data 为数组；单资源 data 为对象；删除 data 为 null
 * - 类型常量：GET /meta → data: { typeMap, types }
 * - body.code：200 成功 / 4** 鉴权 / 5** 错误（400/404 等非鉴权失败在 body 中亦映射为 500）
 */
import * as hierarchyService from '../../services/hierarchy-service.js';
import { NODE_TYPE, TYPE_LABEL } from '../../models/hierarchy-constants.js';

function httpError(err) {
  if (err.code === 'SEED_PROTECTED' || err.code === 'VALIDATION') return 400;
  if (err.code === 'NOT_FOUND') return 404;
  return 500;
}

export default function (app) {
  /**
   * 1. 系统树（children[] 嵌套，可筛选）
   * Query:
   *   name     — 名称模糊查询（命中节点附带 path；会带上祖先以保持树完整）
   *   type     — 1|2|3 类型筛选
   *   limit    — 有 name 时生效，默认 50，最大 500
   *   accounts — 0/false 时不附带账号
   */
  app.get('/api/v2/system-mgmt/tree', async (req, res) => {
    try {
      const includeAccounts = req.query.accounts !== '0' && req.query.accounts !== 'false';
      const name = req.query.name ?? '';
      const type = req.query.type;
      const limit = req.query.limit != null ? +req.query.limit : undefined;
      const nodes = await hierarchyService.getTree({
        includeAccounts,
        keyword: String(name).trim() || undefined,
        type,
        limit,
      });
      res.json(nodes);
    } catch (err) {
      res.status(httpError(err)).json({ error: err.message });
    }
  });

  /** 6. 模板（放在 :id 之前） */
  app.get('/api/v2/system-mgmt/template', (_req, res) => {
    res.json(hierarchyService.getTreeTemplate());
  });

  /** 5. 导出（嵌套 JSON，便于再导入） */
  app.get('/api/v2/system-mgmt/export', async (_req, res) => {
    try {
      const data = await hierarchyService.exportTree();
      res.setHeader('Content-Disposition', 'attachment; filename="system-tree.json"');
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * @deprecated 已合并到 GET /tree?name=&type=
   * 保留别名：等价于 tree?accounts=false&name=...
   */
  app.get('/api/v2/system-mgmt/search', async (req, res) => {
    try {
      const name = req.query.name ?? req.query.q ?? req.query.keyword ?? '';
      if (!String(name).trim()) {
        return res.status(400).json({ error: '请改用 GET /api/v2/system-mgmt/tree?name=关键词（可加 type）' });
      }
      const results = await hierarchyService.getTree({
        includeAccounts: false,
        keyword: String(name).trim(),
        type: req.query.type,
        limit: +req.query.limit || 50,
      });
      res.json(results);
    } catch (err) {
      res.status(httpError(err)).json({ error: err.message });
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

  /** 2. 列表（可选 type / parentId）→ 数组 */
  app.get('/api/v2/system-mgmt/nodes', async (req, res) => {
    try {
      const { type, parentId } = req.query;
      const rows = await hierarchyService.listNodes({
        type: type !== undefined ? type : undefined,
        parentId: parentId !== undefined ? parentId : undefined,
      });
      res.json(rows);
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

  /** 2. 新增 — body: { type, parentId?, name, description?, sortOrder?, url? }；url 仅系统节点有效 */
  app.post('/api/v2/system-mgmt/nodes', async (req, res) => {
    try {
      const body = req.body || {};
      if (body.type === undefined || body.type === null || body.type === '') {
        return res.status(400).json({ error: 'type 必填：1=系统 2=模块 3=功能' });
      }
      const node = await hierarchyService.createNode({
        type: +body.type,
        parentId: body.parentId != null && body.parentId !== '' ? +body.parentId : null,
        name: body.name,
        description: body.description,
        url: body.url,
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

  /** 2. 删除（级联子节点）→ data: null */
  app.delete('/api/v2/system-mgmt/nodes/:id', async (req, res) => {
    try {
      const existing = await hierarchyService.getNode(+req.params.id);
      if (!existing) return res.status(404).json({ error: '节点不存在' });
      await hierarchyService.deleteNode(+req.params.id);
      res.json(null);
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
