/**
 * AI 记忆系统 API（P0）。
 * 契约：POST /api/v2/memory/events | retrieve，GET decisions/audit/stats，GET /trajectories/:id/memory。
 */
import * as memoryService from '../../memory/memory-service.js';
import { asyncHandler } from '../../http/app-error.js';

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

/**
 * Register AI memory system routes (events, retrieve, decisions, audit, compare, timeline, stats).
 * @param {import('express').Application} app Express application
 */
export default function registerMemory(app) {
  /** 批量摄取事件（Agent / 执行机 / 本地脚本上报）。 */
  app.post('/api/v2/memory/events', asyncHandler(async (req, res) => {
    const result = await memoryService.ingestEvents(req.body);
    res.json(result);
  }));

  /** 检索事实包（交互前注入用）。 */
  app.post('/api/v2/memory/retrieve', asyncHandler(async (req, res) => {
    const {
      trajectoryId,
      phaseNumber = null,
      entity = '',
      limit = 50,
      maxChars = 2000,
      functionId = null,
    } = req.body || {};
    if (!trajectoryId) return badRequest(res, 'trajectoryId is required');
    const pack = await memoryService.retrieveFactPack({
      trajectoryId,
      phaseNumber,
      entity,
      limit,
      maxChars,
      functionId,
    });
    res.json(pack);
  }));

  /** 决策详情（外部审计入口）。 */
  app.get('/api/v2/memory/decisions/:id', asyncHandler(async (req, res) => {
    const decision = await memoryService.getDecision(req.params.id);
    if (!decision) return res.status(404).json({ error: 'Decision not found' });
    res.json(decision);
  }));

  /** 决策列表。 */
  app.get('/api/v2/memory/decisions', asyncHandler(async (req, res) => {
    const {
      trajectoryId = null,
      phaseNumber = null,
      decisionType = '',
      auditStatus = '',
      limit = 50,
      offset = 0,
    } = req.query;
    const rows = await memoryService.listDecisions({
      trajectoryId: trajectoryId ? Number(trajectoryId) : null,
      phaseNumber: phaseNumber != null && phaseNumber !== '' ? Number(phaseNumber) : null,
      decisionType,
      auditStatus,
      limit,
      offset,
    });
    res.json({ rows });
  }));

  /** 审计汇总。 */
  app.get('/api/v2/memory/audit/summary', asyncHandler(async (req, res) => {
    const tid = req.query.trajectoryId;
    if (!tid) return badRequest(res, 'trajectoryId is required');
    res.json(await memoryService.auditSummary(tid));
  }));

  /**
   * P2-4：多模型对比报告。
   * Query: trajectoryIds=1,2,3（逗号分隔或重复 query）
   * 400=无有效 id；404=全部缺失；200=至少找到 1 条（找到不足 2 条时 consistency=null）
   */
  app.get('/api/v2/memory/compare', asyncHandler(async (req, res) => {
    const raw = req.query.trajectoryIds ?? req.query.ids ?? '';
    const parts = Array.isArray(raw)
      ? raw.flatMap((x) => String(x).split(','))
      : String(raw).split(',');
    const trajectoryIds = parts
      .map((s) => Number(String(s).trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    const result = await memoryService.compareModels({ trajectoryIds });
    if (result?.status === 400) return badRequest(res, result.error);
    if (result?.status === 404) {
      return res.status(404).json({ error: result.error, missingIds: result.missingIds || [] });
    }
    res.json(result);
  }));

  /** 离线复检（P0：汇总；P1：逐条 policy checks）。 */
  app.post('/api/v2/memory/audit/run', asyncHandler(async (req, res) => {
    const tid = req.body?.trajectoryId;
    if (!tid) return badRequest(res, 'trajectoryId is required');
    res.json(await memoryService.runAudit(tid));
  }));

  /** 交易记忆时间线。 */
  app.get('/api/v2/trajectories/:id/memory', asyncHandler(async (req, res) => {
    res.json(await memoryService.timeline(req.params.id));
  }));

  /** 全局统计。 */
  app.get('/api/v2/memory/stats', asyncHandler(async (_req, res) => {
    res.json(await memoryService.stats());
  }));
}
