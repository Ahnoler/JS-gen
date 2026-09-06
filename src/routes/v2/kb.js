import { asyncHandler, AppError } from '../../http/app-error.js';
import { sendOk } from '../../http/api-response.js';
import { listFlowCards } from '../../services/kb-flow-cards.js';
import { detectStaleCards } from '../../services/change-impact-service.js';
import * as systemDao from '../../dao/system-dao.js';
import * as reqModules from '../../services/kb-req-modules.js';

/**
 * KB routes: flow-card insights (read-only) and req-module workspace registration.
 *
 * Prefix: /api/v2/kb/*
 * @param {import('express').Application} app Express application
 */
export default function registerKbRoutes(app) {
  /** GET /api/v2/kb/cards — 全部流程卡消费侧字段（含 source/source_refs 溯源）。 */
  app.get('/api/v2/kb/cards', asyncHandler(async (req, res) => {
    res.json(await listFlowCards());
  }));

  /** GET /api/v2/kb/stale-cards — menu_path 对当前树三态解析（只读，不写卡）。 */
  app.get('/api/v2/kb/stale-cards', asyncHandler(async (req, res) => {
    const [cards, flatNodes] = await Promise.all([listFlowCards(), systemDao.listAll()]);
    res.json(detectStaleCards(cards, flatNodes));
  }));

  /** POST /api/v2/kb/req-modules — 登记或幂等更新需求模块作业区。 */
  app.post('/api/v2/kb/req-modules', asyncHandler(async (req, res) => {
    const { moduleKey, moduleName, sourcePath, note, reset } = req.body || {};
    if (!moduleKey || !moduleName || !sourcePath) {
      throw new AppError('moduleKey, moduleName, sourcePath required', { code: 'VALIDATION' });
    }
    const manifest = await reqModules.registerReqModule({
      moduleKey, moduleName, sourcePath, note, reset: Boolean(reset),
    });
    sendOk(res, {
      moduleKey: manifest.moduleKey,
      dir: reqModules.moduleDir(manifest.moduleKey),
      manifest,
    });
  }));

  /** GET /api/v2/kb/req-modules — 已登记需求模块清单。 */
  app.get('/api/v2/kb/req-modules', asyncHandler(async (_req, res) => {
    sendOk(res, { rows: await reqModules.listReqModules() });
  }));

  /** GET /api/v2/kb/req-modules/:moduleKey — 模块详情（manifest + 目录探测）。 */
  app.get('/api/v2/kb/req-modules/:moduleKey', asyncHandler(async (req, res) => {
    sendOk(res, await reqModules.getReqModule({ moduleKey: req.params.moduleKey }));
  }));

  /** POST /api/v2/kb/req-modules/:moduleKey/source — 源文档上传（v1 未实现）。 */
  app.post('/api/v2/kb/req-modules/:moduleKey/source', asyncHandler(async (_req, res) => {
    throw new AppError('multipart upload not implemented in v1', { status: 501 });
  }));
}
