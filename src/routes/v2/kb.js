import { asyncHandler, AppError } from '../../http/app-error.js';
import { sendOk } from '../../http/api-response.js';
import { uploadFileSingle, multerHttpStatus } from '../../http/upload-file.js';
import { listFlowCards } from '../../services/kb-flow-cards.js';
import { detectStaleCards } from '../../services/change-impact-service.js';
import * as systemDao from '../../dao/system-dao.js';
import * as reqModules from '../../services/kb-req-modules.js';
import * as reqDraftTraj from '../../services/req-draft-traj/index.js';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

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

  /** POST /api/v2/kb/req-modules/:moduleKey/source — 源文档上传（自包含副本，D4 复用 multer）。 */
  app.post('/api/v2/kb/req-modules/:moduleKey/source', (req, res) => {
    uploadFileSingle(req, res, async (err) => {
      if (err) {
        const status = multerHttpStatus(err) ?? 500;
        return res.status(status).json({ error: err.message });
      }
      try {
        const moduleKey = req.params.moduleKey;
        const mod = await reqModules.getReqModule({ moduleKey });
        if (!mod) {
          throw new AppError(`req module not found: ${moduleKey}`, { code: 'NOT_FOUND' });
        }
        const file = req.file;
        if (!file || !file.buffer?.length) {
          throw new AppError('multipart field "file" required', { code: 'VALIDATION' });
        }
        const safeName = basename(String(file.originalname || '')).replace(/[\\/:*?"<>|]/g, '_');
        if (!safeName) {
          throw new AppError('upload filename invalid', { code: 'VALIDATION' });
        }
        const modDir = reqModules.moduleDir(moduleKey);
        const sourceDir = join(modDir, 'source');
        await mkdir(sourceDir, { recursive: true });
        await writeFile(join(sourceDir, safeName), file.buffer);
        const sha256 = createHash('sha256').update(file.buffer).digest('hex');

        let link = {};
        try {
          link = JSON.parse(await readFile(join(modDir, 'source.link.json'), 'utf-8'));
        } catch {
          link = {};
        }
        link.localCopy = `source/${safeName}`;
        link.sha256 = sha256;
        link.bytes = file.buffer.length;
        link.uploadedAt = new Date().toISOString();
        if (!link.sourcePath) link.sourcePath = safeName;
        await writeFile(join(modDir, 'source.link.json'), `${JSON.stringify(link, null, 2)}\n`, 'utf-8');

        return sendOk(res, {
          moduleKey,
          localCopy: link.localCopy,
          sha256,
          bytes: link.bytes,
          uploadedAt: link.uploadedAt,
        });
      } catch (e) {
        const ae = e instanceof AppError ? e : new AppError(e.message || 'upload failed', { code: 'VALIDATION' });
        return res.status(ae.status).json({ error: ae.message, code: ae.code });
      }
    });
  });

  /** POST /api/v2/kb/req-modules/:moduleKey/draft-traj/propose — LLM 原子化候选（写 propose 缓存）。 */
  app.post('/api/v2/kb/req-modules/:moduleKey/draft-traj/propose', asyncHandler(async (req, res) => {
    const { chainIds, maxAtoms } = req.body || {};
    const result = await reqDraftTraj.proposeDraftTrajectories({
      moduleKey: req.params.moduleKey,
      chainIds,
      maxAtoms,
    });
    sendOk(res, result);
  }));

  /** POST /api/v2/kb/req-modules/:moduleKey/draft-traj/commit — 勾选原子建 draft 交易（不录制）。 */
  app.post('/api/v2/kb/req-modules/:moduleKey/draft-traj/commit', asyncHandler(async (req, res) => {
    const { atomKeys, systemAccountId, paasUserId, functionIdOverrides, flowRefOverrides, force } = req.body || {};
    if (!Array.isArray(atomKeys) || !atomKeys.length) {
      throw new AppError('atomKeys required', { code: 'VALIDATION' });
    }
    const overrides = (functionIdOverrides && typeof functionIdOverrides === 'object')
      ? functionIdOverrides
      : {};
    const flowOverrides = (flowRefOverrides && typeof flowRefOverrides === 'object')
      ? flowRefOverrides
      : {};
    const result = await reqDraftTraj.commitDraftTrajectories({
      moduleKey: req.params.moduleKey,
      atomKeys,
      systemAccountId,
      paasUserId: paasUserId != null ? String(paasUserId) : null,
      functionIdOverrides: overrides,
      flowRefOverrides: flowOverrides,
      force: Boolean(force),
    });
    sendOk(res, result);
  }));

  /** POST /api/v2/kb/req-modules/:moduleKey/draft-traj/validate — commit 预校验（不写库、不调 LLM）。 */
  app.post('/api/v2/kb/req-modules/:moduleKey/draft-traj/validate', asyncHandler(async (req, res) => {
    const { atomKeys, functionIdOverrides, force } = req.body || {};
    if (!Array.isArray(atomKeys) || !atomKeys.length) {
      throw new AppError('atomKeys required', { code: 'VALIDATION' });
    }
    const overrides = (functionIdOverrides && typeof functionIdOverrides === 'object')
      ? functionIdOverrides
      : {};
    const result = await reqDraftTraj.validateCommitAtoms({
      moduleKey: req.params.moduleKey,
      atomKeys,
      functionIdOverrides: overrides,
      force: Boolean(force),
    });
    sendOk(res, { ok: result.ok, problems: result.problems });
  }));
}
