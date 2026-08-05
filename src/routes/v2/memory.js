/**
 * AI 记忆系统 API（P0）。
 * 契约：POST /api/v2/memory/events | retrieve，GET decisions/audit/stats，GET /trajectories/:id/memory。
 */
import * as memoryService from '../../memory/memory-service.js';

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

export default function registerMemory(app) {
  /** 批量摄取事件（Agent / 执行机 / 本地脚本上报）。 */
  app.post('/api/v2/memory/events', async (req, res) => {
    try {
      const result = await memoryService.ingestEvents(req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** 检索事实包（交互前注入用）。 */
  app.post('/api/v2/memory/retrieve', async (req, res) => {
    try {
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
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** 决策详情（外部审计入口）。 */
  app.get('/api/v2/memory/decisions/:id', async (req, res) => {
    try {
      const decision = await memoryService.getDecision(req.params.id);
      if (!decision) return res.status(404).json({ error: 'Decision not found' });
      res.json(decision);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** 决策列表。 */
  app.get('/api/v2/memory/decisions', async (req, res) => {
    try {
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
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** 审计汇总。 */
  app.get('/api/v2/memory/audit/summary', async (req, res) => {
    try {
      const tid = req.query.trajectoryId;
      if (!tid) return badRequest(res, 'trajectoryId is required');
      res.json(await memoryService.auditSummary(tid));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** 离线复检（P0：汇总；P1：逐条 policy checks）。 */
  app.post('/api/v2/memory/audit/run', async (req, res) => {
    try {
      const tid = req.body?.trajectoryId;
      if (!tid) return badRequest(res, 'trajectoryId is required');
      res.json(await memoryService.runAudit(tid));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** 交易记忆时间线。 */
  app.get('/api/v2/trajectories/:id/memory', async (req, res) => {
    try {
      res.json(await memoryService.timeline(req.params.id));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** 全局统计。 */
  app.get('/api/v2/memory/stats', async (_req, res) => {
    try {
      res.json(await memoryService.stats());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
