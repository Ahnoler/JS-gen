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
 * - template / export 返回 Excel 二进制（不走 JSON 信封）；import 接受 multipart Excel
 */
import multer from 'multer';
import * as hierarchyService from '../../services/hierarchy-service.js';
import { EXCEL_MIME } from '../../services/system-mgmt-excel.js';
import { NODE_TYPE, TYPE_LABEL } from '../../models/hierarchy-constants.js';
import { importMenuJson } from '../../services/menu-json-import.js';
import { startScan, getScan, startFillPageIds } from '../../services/menu-scan-service.js';
import { pushMenuForSystem, getMenuPushStatus } from '../../services/menu-push.js';
import { resolveAccessToken } from '../../services/partner-platform.js';
import * as menuChangeLogDao from '../../dao/menu-change-log-dao.js';
import { asyncHandler, AppError } from '../../http/app-error.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const name = String(file.originalname || '').toLowerCase();
    const ok =
      name.endsWith('.xlsx')
      || name.endsWith('.xls')
      || String(file.mimetype || '').includes('sheet')
      || String(file.mimetype || '').includes('excel')
      || file.mimetype === 'application/octet-stream';
    if (!ok) {
      return cb(Object.assign(new Error('请上传 Excel 文件（.xlsx）'), { code: 'VALIDATION' }));
    }
    cb(null, true);
  },
});

const jsonUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const name = String(file.originalname || '').toLowerCase();
    const ok =
      name.endsWith('.json')
      || String(file.mimetype || '').includes('json')
      || file.mimetype === 'application/octet-stream';
    if (!ok) {
      return cb(Object.assign(new Error('请上传 JSON 文件（.json）'), { code: 'VALIDATION' }));
    }
    cb(null, true);
  },
});

function httpError(err) {
  if (err.code === 'SEED_PROTECTED' || err.code === 'VALIDATION') return 400;
  if (err.code === 'NOT_FOUND') return 404;
  if (err.code === 'CONFLICT') return 409;
  if (err instanceof multer.MulterError) return 400;
  return 500;
}

/**
 * Re-throw a service error as AppError preserving the legacy httpError() mapping.
 * @param {Error & { code?: string }} err service error
 * @returns {never} never returns — always throws
 */
function toHttp(err) {
  throw new AppError(err.message, { code: err.code, status: httpError(err) });
}

function sendExcel(res, buffer, filename) {
  res.setHeader('Content-Type', EXCEL_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', Buffer.byteLength(buffer));
  res.send(buffer);
}

/**
 * Register system-management routes (tree, nodes CRUD, template/export/import, meta).
 * @param {import('express').Application} app Express application
 */
export default function (app) {
  /**
   * 1. 系统树（始终以 id=0 根为唯一顶层）
   * Query:
   *   name     — 名称模糊（命中节点附带 path，不含「根」；保留祖先）
   *   type     — 1|2|3 类型筛选
   *   limit    — 有 name 时生效，默认 50，最大 500
   *   accounts — 0/false 时不附带账号
   * data: [{ id:0, type:0, name:'根', children:[ 系统… ] }]
   */
  app.get('/api/v2/system-mgmt/tree', asyncHandler(async (req, res) => {
    const includeAccounts = req.query.accounts !== '0' && req.query.accounts !== 'false';
    const name = req.query.name ?? '';
    const type = req.query.type;
    const limit = req.query.limit != null ? +req.query.limit : undefined;
    try {
      const nodes = await hierarchyService.getTree({
        includeAccounts,
        keyword: String(name).trim() || undefined,
        type,
        limit,
      });
      res.json(nodes);
    } catch (err) {
      toHttp(err);
    }
  }));

  /** 6. 模板（Excel） */
  app.get('/api/v2/system-mgmt/template', asyncHandler(async (_req, res) => {
    try {
      const buf = await hierarchyService.getTreeTemplateExcel();
      sendExcel(res, buf, 'system-tree-template.xlsx');
    } catch (err) {
      toHttp(err);
    }
  }));

  /** 5. 导出（Excel，列与模板一致） */
  app.get('/api/v2/system-mgmt/export', asyncHandler(async (_req, res) => {
    try {
      const buf = await hierarchyService.exportTreeExcel();
      sendExcel(res, buf, 'system-tree-export.xlsx');
    } catch (err) {
      toHttp(err);
    }
  }));

  /**
   * Legacy: 已合并到 GET /tree?name=&type=
   * 保留别名：等价于 tree?accounts=false&name=...
   */
  app.get('/api/v2/system-mgmt/search', asyncHandler(async (req, res) => {
    const name = req.query.name ?? req.query.q ?? req.query.keyword ?? '';
    if (!String(name).trim()) {
      return res.status(400).json({ error: '请改用 GET /api/v2/system-mgmt/tree?name=关键词（可加 type）' });
    }
    try {
      const results = await hierarchyService.getTree({
        includeAccounts: false,
        keyword: String(name).trim(),
        type: req.query.type,
        limit: +req.query.limit || 50,
      });
      res.json(results);
    } catch (err) {
      toHttp(err);
    }
  }));

  /**
   * 4. 导入 Excel（multipart field: file）
   * Query/body: mode=merge|append（默认 merge，按 父路径+名称+类型 合并）
   */
  app.post('/api/v2/system-mgmt/import', (req, res) => {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(httpError(err)).json({ error: err.message });
      }
      try {
        if (!req.file?.buffer?.length) {
          return res.status(400).json({ error: '请上传 Excel 文件（form-data 字段名 file）' });
        }
        const mode = req.body?.mode || req.query?.mode || 'merge';
        const result = await hierarchyService.importTreeExcel(req.file.buffer, { mode });
        res.status(201).json(result);
      } catch (e) {
        res.status(httpError(e)).json({ error: e.message });
      }
    });
  });

  /**
   * 4.1 导入菜单 JSON（被测系统《建模组件关系》文件，multipart field: file）
   * :id 必须是系统类型节点（type=1）；解析 umlRelInfo 建两级菜单树，按 umlEcd 幂等更新
   */
  app.post('/api/v2/system-mgmt/nodes/:id/import-json', (req, res) => {
    jsonUpload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(httpError(err)).json({ error: err.message });
      }
      try {
        if (!req.file?.buffer?.length) {
          return res.status(400).json({ error: '请上传 JSON 文件（form-data 字段名 file）' });
        }
        const result = await importMenuJson(req.params.id, req.file.buffer);
        if (req.query.autoScan !== 'false') {
          startScan(Number(req.params.id)).catch(() => {});
        }
        res.status(201).json(result);
      } catch (e) {
        res.status(httpError(e)).json({ error: e.message });
      }
    });
  });

  /**
   * 4.2 触发菜单扫描（后台执行：打开被测系统→自动登录→提取全部菜单 xpath→回写/新增）
   */
  app.post('/api/v2/system-mgmt/nodes/:id/scan-menu', asyncHandler(async (req, res) => {
    try {
      const result = await startScan(Number(req.params.id));
      res.status(202).json(result);
    } catch (e) {
      toHttp(e);
    }
  }));

  /**
   * 4.2b 仅补采落地 pageId（默认 source=ai；不扫菜单树）
   * query.sources=ai,json_import 可覆盖；空=默认 ai
   */
  app.post('/api/v2/system-mgmt/nodes/:id/fill-pageid', asyncHandler(async (req, res) => {
    try {
      const raw = String(req.query.sources || '').trim();
      const sources = raw
        ? raw.split(',').map((s) => s.trim()).filter(Boolean)
        : ['ai'];
      const result = await startFillPageIds(Number(req.params.id), { sources });
      res.status(202).json(result);
    } catch (e) {
      toHttp(e);
    }
  }));

  /** 4.3 菜单扫描状态轮询（running→202，completed/failed→200） */
  app.get('/api/v2/system-mgmt/menu-scan/:scanId', asyncHandler(async (req, res) => {
    try {
      const job = getScan(req.params.scanId);
      res.status(job.status === 'running' ? 202 : 200).json(job);
    } catch (e) {
      toHttp(e);
    }
  }));

  /** 4.4 菜单变更历史（导入/扫描逐事件流水，测试人员与手动迁移排查用） */
  app.get('/api/v2/system-mgmt/nodes/:id/change-log', asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
      const rows = await menuChangeLogDao.listBySystem(Number(req.params.id), { version: req.query.version || null, limit });
      res.json(rows);
    } catch (e) {
      toHttp(e);
    }
  }));

  /** 4.5 推送系统菜单至伙伴平台（202 异步语义） */
  app.post('/api/v2/system-mgmt/nodes/:id/push-menu', asyncHandler(async (req, res) => {
    try {
      const body = req.body || {};
      const partnerSystemId = body.partnerSystemId ?? body.systemNodeId;
      const partnerSystemName = body.partnerSystemName ?? body.systemName;
      const result = await pushMenuForSystem(Number(req.params.id), {
        accessToken: resolveAccessToken(req) || undefined,
        partnerSystemId,
        partnerSystemName,
      });
      res.status(202).json(result);
    } catch (e) {
      toHttp(e);
    }
  }));

  /** 4.6 菜单推送状态轮询（pushing→synced 由 auto-sync 窗口纠偏） */
  app.get('/api/v2/system-mgmt/nodes/:id/push-menu/status', asyncHandler(async (req, res) => {
    try {
      const result = await getMenuPushStatus(Number(req.params.id));
      res.json(result);
    } catch (e) {
      toHttp(e);
    }
  }));

  /** 2. 列表（可选 type / parentId）→ 数组 */
  app.get('/api/v2/system-mgmt/nodes', asyncHandler(async (req, res) => {
    const { type, parentId } = req.query;
    try {
      const rows = await hierarchyService.listNodes({
        type: type !== undefined ? type : undefined,
        parentId: parentId !== undefined ? parentId : undefined,
      });
      res.json(rows);
    } catch (err) {
      toHttp(err);
    }
  }));

  /** 2. 详情 */
  app.get('/api/v2/system-mgmt/nodes/:id', asyncHandler(async (req, res) => {
    try {
      const node = await hierarchyService.getNode(+req.params.id);
      if (!node) return res.status(404).json({ error: '节点不存在' });
      res.json(node);
    } catch (err) {
      toHttp(err);
    }
  }));

  /** 2. 新增 — body: { type, parentId?, name, description?, sortOrder?, url?, accounts? }；type=1 可一次创建多个系统账号 */
  app.post('/api/v2/system-mgmt/nodes', asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (body.type === undefined || body.type === null || body.type === '') {
      return res.status(400).json({ error: 'type 必填：1=系统 2=模块 3=功能' });
    }
    try {
      const node = await hierarchyService.createNode({
        type: +body.type,
        parentId: body.parentId != null && body.parentId !== '' ? +body.parentId : undefined,
        name: body.name,
        description: body.description,
        url: body.url,
        sortOrder: body.sortOrder,
        systemId: body.uid || body.systemId,
        accounts: body.accounts,
      });
      res.status(201).json(node);
    } catch (err) {
      toHttp(err);
    }
  }));

  /** 2. 修改 — type=1 节点可带 accounts[] 全量替换该系统账号 */
  app.put('/api/v2/system-mgmt/nodes/:id', asyncHandler(async (req, res) => {
    try {
      const node = await hierarchyService.updateNode(+req.params.id, req.body || {});
      if (!node) return res.status(404).json({ error: '节点不存在' });
      res.json(node);
    } catch (err) {
      toHttp(err);
    }
  }));

  /** 2. 删除（级联子节点）→ data: null */
  app.delete('/api/v2/system-mgmt/nodes/:id', asyncHandler(async (req, res) => {
    try {
      const existing = await hierarchyService.getNode(+req.params.id);
      if (!existing) return res.status(404).json({ error: '节点不存在' });
      await hierarchyService.deleteNode(+req.params.id);
      res.json(null);
    } catch (err) {
      toHttp(err);
    }
  }));

  // expose constants for clients
  /** Expose hierarchy type constants (typeMap + types) for clients. */
  app.get('/api/v2/system-mgmt/meta', (_req, res) => {
    res.json({
      typeMap: TYPE_LABEL,
      types: [
        { type: NODE_TYPE.ROOT, label: '根' },
        { type: NODE_TYPE.SYSTEM, label: '系统' },
        { type: NODE_TYPE.MODULE, label: '模块' },
        { type: NODE_TYPE.FUNCTION, label: '功能' },
      ],
    });
  });
}
