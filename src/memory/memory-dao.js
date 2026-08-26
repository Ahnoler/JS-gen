/**
 * 记忆系统数据访问层（4 张表）。
 * 约定：append-only；trajectory_id 为逻辑关联，不做硬外键。
 */
import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from '../dao/helpers.js';

const EVENT_TABLE = 'memory_event';
const FACT_TABLE = 'memory_fact';
const RELATION_TABLE = 'memory_relation';
const DECISION_TABLE = 'decision_record';

function tableExists(db, name) {
  return db.schema.hasTable(name);
}

/**
 * 写入前确认表已存在（schema 未迁移时返回 false，调用方决定降级）。
 * @returns {Promise<boolean>} True if all four memory tables exist.
 */
export async function isReady() {
  try {
    const db = getDB();
    return Promise.all([
      tableExists(db, EVENT_TABLE),
      tableExists(db, FACT_TABLE),
      tableExists(db, RELATION_TABLE),
      tableExists(db, DECISION_TABLE),
    ]).then((r) => r.every(Boolean));
  } catch {
    return false;
  }
}

/**
 * 批量插入事件，返回 id 列表。
 * @param {object[]} events Event rows to insert.
 * @param {object} [trx] Optional transaction handle.
 * @returns {Promise<number[]>} Inserted event ids.
 */
export async function insertEvents(events, trx = null) {
  if (!Array.isArray(events) || !events.length) return [];
  const db = trx || getDB();
  const rows = events.map((e) => toDbRow(e));
  const ids = await db(EVENT_TABLE).insert(rows);
  return ids.map((x) => Number(x));
}

/**
 * 批量插入事实（含权重默认值已在 service 计算）。
 * @param {object[]} facts Fact rows to insert.
 * @param {object} [trx] Optional transaction handle.
 * @returns {Promise<number[]>} Inserted fact ids.
 */
export async function insertFacts(facts, trx = null) {
  if (!Array.isArray(facts) || !facts.length) return [];
  const db = trx || getDB();
  const rows = facts.map((f) => toDbRow(f));
  const ids = await db(FACT_TABLE).insert(rows);
  return ids.map((x) => Number(x));
}

/**
 * 当前版本事实（superseded_by IS NULL）按实体+属性查找（冲突版本化用）。
 * @param {number} trajectoryId Trajectory id.
 * @param {string} entity Fact entity.
 * @param {string} attribute Fact attribute.
 * @param {object} [trx] Optional transaction handle.
 * @param {number} [excludeEventId] Exclude facts from this event id.
 * @returns {Promise<object|null>} Latest current-version fact row, or null.
 */
export async function currentFactByEntity(trajectoryId, entity, attribute, trx = null, excludeEventId = null) {
  const db = trx || getDB();
  const q = db(FACT_TABLE)
    .where({ trajectory_id: Number(trajectoryId), entity: String(entity), attribute: String(attribute) })
    .whereNull('superseded_by');
  if (excludeEventId != null) q.whereNot({ event_id: Number(excludeEventId) });
  return q.orderBy('id', 'desc').first();
}

/**
 * 标记旧事实被新版本取代：superseded_by + disputed stance + 按 disputed 重算存储权重。
 * @param {number} id Fact id to supersede.
 * @param {number} newId New version fact id.
 * @param {object} [trx] Optional transaction handle.
 * @returns {Promise<boolean>} True if the fact was found and updated.
 */
export async function markFactSuperseded(id, newId, trx = null) {
  const db = trx || getDB();
  const row = await db(FACT_TABLE).where({ id: Number(id) }).first();
  if (!row) return false;
  const { storedWeight } = await import('./weight-engine.js');
  await db(FACT_TABLE).where({ id: Number(id) }).update({
    superseded_by: Number(newId),
    stance: 'disputed',
    weight: storedWeight({ source: row.source, stance: 'disputed', baseWeight: row.base_weight }),
  });
  return true;
}

/**
 * 设置事实版本号（新版本在旧版本基础上 +1）。
 * @param {number} id Fact id.
 * @param {number} version Version number to set.
 * @param {object} [trx] Optional transaction handle.
 * @returns {Promise<boolean>} True on success.
 */
export async function setFactVersion(id, version, trx = null) {
  const db = trx || getDB();
  await db(FACT_TABLE).where({ id: Number(id) }).update({ version: Number(version) });
  return true;
}

/**
 * 按阶段+属性查当前版本事实（fill_before_save 建模用）。
 * @param {number} trajectoryId Trajectory id.
 * @param {number} phaseNumber Phase number.
 * @param {string} attribute Fact attribute.
 * @param {object} [trx] Optional transaction handle.
 * @returns {Promise<object[]>} Current-version facts matching the phase + attribute.
 */
export async function factsByPhaseAttribute(trajectoryId, phaseNumber, attribute, trx = null) {
  const db = trx || getDB();
  const rows = await db(FACT_TABLE)
    .where({
      trajectory_id: Number(trajectoryId),
      phase_number: Number(phaseNumber),
      attribute: String(attribute),
    })
    .whereNull('superseded_by')
    .orderBy('id');
  return fromDbRows(rows);
}

/**
 * 按来源事件取回事实 id 列表（多行 INSERT 仅返回单 insertId，需按 event_id 回查）。
 * @param {number} eventId Source event id.
 * @param {object} [trx] Optional transaction handle.
 * @returns {Promise<number[]>} Fact ids created by the event.
 */
export async function factIdsByEvent(eventId, trx = null) {
  const db = trx || getDB();
  const rows = await db(FACT_TABLE)
    .where({ event_id: eventId })
    .select('id')
    .orderBy('id');
  return rows.map((r) => Number(r.id));
}

/**
 * 批量插入/更新关系（冲突则提升 strength）。
 * @param {object[]} relations Relation rows to upsert.
 * @param {object} [trx] Optional transaction handle.
 * @returns {Promise<number>} Number of relations upserted.
 */
export async function upsertRelations(relations, trx = null) {
  if (!Array.isArray(relations) || !relations.length) return 0;
  const db = trx || getDB();
  let n = 0;
  for (const rel of relations) {
    const row = toDbRow(rel);
    const existing = await db(RELATION_TABLE)
      .where({
        trajectory_id: row.trajectory_id,
        from_fact_id: row.from_fact_id,
        to_fact_id: row.to_fact_id,
        relation_type: row.relation_type,
      })
      .first();
    if (existing) {
      await db(RELATION_TABLE)
        .where({ id: existing.id })
        .update({ strength: Math.min(1, Number(existing.strength) + Number(row.strength || 0)) });
    } else {
      await db(RELATION_TABLE).insert(row);
    }
    n += 1;
  }
  return n;
}

/**
 * 插入一条决策记录。
 * @param {object} decision Decision row to insert.
 * @param {object} [trx] Optional transaction handle.
 * @returns {Promise<number|null>} Inserted decision id, or null when input empty.
 */
export async function insertDecision(decision, trx = null) {
  if (!decision) return null;
  const db = trx || getDB();
  const [id] = await db(DECISION_TABLE).insert(toDbRow(decision));
  return Number(id);
}

/**
 * 更新决策审计状态。
 * @param {number} id Decision id.
 * @param {{ auditStatus?: string }} [opts] Audit status payload.
 * @returns {Promise<boolean>} True if a row was updated.
 */
export async function updateDecisionAudit(id, { auditStatus } = {}) {
  if (!Number.isFinite(Number(id))) return false;
  const n = await getDB()(DECISION_TABLE)
    .where({ id: Number(id) })
    .update({ audit_status: String(auditStatus || 'pending') });
  return n > 0;
}

/**
 * 事件列表（按交易/会话/阶段/类型过滤）。
 * @param {object} [opts] Query options.
 * @param {number} [opts.trajectoryId] Trajectory id filter.
 * @param {string} [opts.sessionId] Session id filter (used when trajectoryId absent).
 * @param {number} [opts.phaseNumber] Phase number filter.
 * @param {string} [opts.eventType] Event type filter.
 * @param {number} [opts.limit] Max rows (capped at 500).
 * @param {number} [opts.offset] Row offset.
 * @returns {Promise<object[]>} Matching event rows (newest first).
 */
export async function listEvents({
  trajectoryId = null,
  sessionId = '',
  phaseNumber = null,
  eventType = '',
  limit = 100,
  offset = 0,
} = {}) {
  const db = getDB();
  let q = db(EVENT_TABLE).orderBy('id', 'desc');
  if (trajectoryId != null) q = q.where({ trajectory_id: Number(trajectoryId) });
  else if (sessionId) q = q.where({ session_id: String(sessionId) });
  if (phaseNumber != null) q = q.where({ phase_number: Number(phaseNumber) });
  if (eventType) q = q.where({ event_type: String(eventType) });
  const rows = await q.limit(Math.min(Number(limit) || 100, 500)).offset(Number(offset) || 0);
  return fromDbRows(rows);
}

/**
 * 事实列表（默认只取当前版本 superseded_by IS NULL）。
 * @param {object} opts Query options.
 * @param {number} opts.trajectoryId Trajectory id (required).
 * @param {number} [opts.phaseNumber] Phase number filter (also matches NULL phase).
 * @param {string} [opts.entity] Entity substring filter.
 * @param {string} [opts.attribute] Exact attribute filter.
 * @param {number} [opts.limit] Max rows (capped at 200).
 * @param {boolean} [opts.currentOnly] True to exclude superseded facts (default true).
 * @returns {Promise<object[]>} Matching fact rows (weight desc, then created_at desc).
 */
export async function listFacts({
  trajectoryId,
  phaseNumber = null,
  entity = '',
  attribute = '',
  limit = 50,
  currentOnly = true,
} = {}) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) return [];
  const db = getDB();
  let q = db(FACT_TABLE).where({ trajectory_id: tid });
  if (phaseNumber != null) {
    // 匹配指定阶段；同时兼容 P0 无归属（phase_number NULL）的交易级事实
    q = q.where((b) => b.where({ phase_number: Number(phaseNumber) }).orWhereNull('phase_number'));
  }
  if (entity) q = q.where('entity', 'like', `%${String(entity)}%`);
  if (attribute) q = q.where('attribute', String(attribute));
  if (currentOnly) q = q.whereNull('superseded_by');
  const rows = await q
    .orderBy('weight', 'desc')
    .orderBy('created_at', 'desc')
    .limit(Math.min(Number(limit) || 50, 200));
  return fromDbRows(rows);
}

/**
 * 决策列表。
 * @param {object} [opts] Query options.
 * @param {number} [opts.trajectoryId] Trajectory id filter.
 * @param {number} [opts.phaseNumber] Phase number filter.
 * @param {string} [opts.decisionType] Decision type filter.
 * @param {string} [opts.auditStatus] Audit status filter.
 * @param {number} [opts.limit] Max rows (capped at 500).
 * @param {number} [opts.offset] Row offset.
 * @returns {Promise<object[]>} Matching decision rows (newest first).
 */
export async function listDecisions({
  trajectoryId = null,
  phaseNumber = null,
  decisionType = '',
  auditStatus = '',
  limit = 50,
  offset = 0,
} = {}) {
  const db = getDB();
  let q = db(DECISION_TABLE).orderBy('id', 'desc');
  if (trajectoryId != null) q = q.where({ trajectory_id: Number(trajectoryId) });
  if (phaseNumber != null) q = q.where({ phase_number: Number(phaseNumber) });
  if (decisionType) q = q.where({ decision_type: String(decisionType) });
  if (auditStatus) q = q.where({ audit_status: String(auditStatus) });
  const rows = await q.limit(Math.min(Number(limit) || 50, 500)).offset(Number(offset) || 0);
  return fromDbRows(rows);
}

/**
 * 决策详情。
 * @param {number} id Decision id.
 * @returns {Promise<object|null>} Decision row, or null when not found.
 */
export async function getDecision(id) {
  const row = await getDB()(DECISION_TABLE).where({ id: Number(id) }).first();
  return row ? fromDbRow(row) : null;
}

/**
 * 按 id 批量查事实（含被 supersede 的版本，用于审计复现）。
 * @param {number[]} ids Fact ids (order preserved in output).
 * @returns {Promise<object[]>} Fact rows in the requested order (missing ids dropped).
 */
export async function listFactsByIds(ids) {
  const nums = Array.from(
    new Set((Array.isArray(ids) ? ids : [])
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0)),
  );
  if (!nums.length) return [];
  const rows = await getDB()(FACT_TABLE).whereIn('id', nums);
  const map = new Map(rows.map((r) => [Number(r.id), fromDbRow(r)]));
  return nums.map((n) => map.get(n)).filter(Boolean);
}

/**
 * P2-2：同 function 历史成功交易的当前版本事实（跨交易复用）。
 * 仅取 is_successful=1 的其它交易；返回时打上 source='history' + stance='inferred'
 * + weight ×0.5，绝不参与本交易冲突 supersede（调用方负责排序靠后）。
 * @param {number} functionId Function id to reuse history from.
 * @param {number} excludeTrajectoryId Current trajectory id to exclude.
 * @param {{ limit?: number }} [opts] Query options.
 * @returns {Promise<object[]>} History-sourced facts (re-tagged source/stance/weight).
 */
export async function listFactsByFunctionHistory(functionId, excludeTrajectoryId, { limit = 20 } = {}) {
  const fid = Number(functionId);
  const exTid = Number(excludeTrajectoryId);
  if (!Number.isFinite(fid) || fid <= 0 || !Number.isFinite(exTid) || exTid <= 0) return [];
  const db = getDB();
  const trajRows = await db('trajectory')
    .where({ function_id: fid, is_successful: 1 })
    .whereNot({ id: exTid })
    .orderBy('id', 'desc')
    .limit(5)
    .select('id');
  const trajIds = trajRows.map((r) => Number(r.id));
  if (!trajIds.length) return [];
  const rows = await db(FACT_TABLE)
    .whereIn('trajectory_id', trajIds)
    .whereNull('superseded_by')
    .orderBy('weight', 'desc')
    .orderBy('created_at', 'desc')
    .limit(Math.min(Number(limit) || 20, 100));
  return fromDbRows(rows).map((f) => ({
    ...f,
    source: 'history',
    stance: 'inferred',
    weight: Number((Number(f.weight || 0) * 0.5).toFixed(4)),
  }));
}

/**
 * P2-4：按 id 批量取交易基础字段（对比报告用）。
 * @param {number[]} ids Trajectory ids (capped at 10, order preserved).
 * @returns {Promise<object[]>} Trajectory rows in the requested order.
 */
export async function listTrajectoriesByIds(ids) {
  const nums = Array.from(
    new Set((Array.isArray(ids) ? ids : [])
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0)),
  ).slice(0, 10);
  if (!nums.length) return [];
  const rows = await getDB()('trajectory')
    .whereIn('id', nums)
    .select(
      'id',
      'model',
      'task',
      'step_count',
      'phase_count',
      'is_successful',
      'is_done',
      'function_id',
    );
  const map = new Map(rows.map((r) => [Number(r.id), fromDbRow(r)]));
  // 保持请求顺序
  return nums.map((n) => map.get(n)).filter(Boolean);
}

/**
 * P2-4：多交易当前版本 value 事实（formValues 原料）。
 * 调用方再按 source 白名单过滤；同 (trajectory, entity) 多条由调用方按 weight 取最高。
 * @param {number[]} ids Trajectory ids.
 * @returns {Promise<object[]>} Current-version value facts across the trajectories.
 */
export async function listCurrentValueFactsByTrajectories(ids) {
  const nums = Array.from(
    new Set((Array.isArray(ids) ? ids : [])
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0)),
  );
  if (!nums.length) return [];
  const rows = await getDB()(FACT_TABLE)
    .whereIn('trajectory_id', nums)
    .where({ attribute: 'value' })
    .whereNull('superseded_by')
    .orderBy('weight', 'desc')
    .orderBy('created_at', 'desc');
  return fromDbRows(rows);
}

/**
 * 交易审计汇总。
 * @param {number} trajectoryId Trajectory id.
 * @returns {Promise<{ trajectoryId: number|null, total: number, byStatus: Record<string, number>, overridden: number, topReferencedFacts: Array<{ id: number, refs: number, entity: string|null, attribute: string|null, value: string|null }> }>} Audit summary.
 */
export async function auditSummary(trajectoryId) {
  const tid = Number(trajectoryId);
  const db = getDB();
  if (!Number.isFinite(tid) || tid <= 0) {
    return { trajectoryId: null, total: 0, byStatus: {}, overridden: 0, topReferencedFacts: [] };
  }
  const rows = await db(DECISION_TABLE).where({ trajectory_id: tid });
  const byStatus = { pending: 0, passed: 0, failed: 0 };
  let overridden = 0;
  for (const r of rows) {
    byStatus[r.audit_status] = (byStatus[r.audit_status] || 0) + 1;
    if (r.overridden) overridden += 1;
  }

  // P2-1: most-referenced facts across this trajectory's decisions
  const counts = new Map();
  for (const r of rows) {
    const raw = r.input_fact_ids;
    if (!raw) continue;
    let ids = raw;
    if (typeof raw === 'string') {
      try { ids = JSON.parse(raw); } catch { continue; }
    }
    if (!Array.isArray(ids)) continue;
    for (const fid of ids) {
      const n = Number(fid);
      if (!Number.isFinite(n) || n <= 0) continue;
      counts.set(n, (counts.get(n) || 0) + 1);
    }
  }
  const topIds = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  let topReferencedFacts = [];
  if (topIds.length) {
    const facts = await listFactsByIds(topIds.map(([id]) => id));
    const factMap = new Map(facts.map((f) => [Number(f.id), f]));
    topReferencedFacts = topIds.map(([id, refs]) => ({
      id,
      refs,
      entity: factMap.get(id)?.entity ?? null,
      attribute: factMap.get(id)?.attribute ?? null,
      value: factMap.get(id)?.value ?? null,
    }));
  }

  return { trajectoryId: tid, total: rows.length, byStatus, overridden, topReferencedFacts };
}

/**
 * 全局统计（P0 简单计数，P1 扩展延迟/命中率）。
 * @returns {Promise<{ tables: Record<string, number>, recentEventTypes: Array<{ eventType: string, count: number }> }>} Global memory stats.
 */
export async function stats() {
  const db = getDB();
  const [events] = await db(EVENT_TABLE).count('* as n');
  const [facts] = await db(FACT_TABLE).count('* as n');
  const [relations] = await db(RELATION_TABLE).count('* as n');
  const [decisions] = await db(DECISION_TABLE).count('* as n');
  const recent = await db(EVENT_TABLE)
    .select('event_type')
    .count('* as n')
    .groupBy('event_type')
    .orderBy('n', 'desc')
    .limit(10);
  return {
    tables: {
      memoryEvent: Number(events?.n || 0),
      memoryFact: Number(facts?.n || 0),
      memoryRelation: Number(relations?.n || 0),
      decisionRecord: Number(decisions?.n || 0),
    },
    recentEventTypes: recent.map((r) => ({ eventType: r.event_type, count: Number(r.n) })),
  };
}

/**
 * 交易记忆时间线：事件 + 事实 + 决策。
 * @param {number} trajectoryId Trajectory id.
 * @returns {Promise<{ trajectoryId: number|null, events: object[], facts: object[], decisions: object[] }>} Timeline bundle.
 */
export async function timeline(trajectoryId) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) {
    return { trajectoryId: null, events: [], facts: [], decisions: [] };
  }
  const [events, facts, decisions] = await Promise.all([
    listEvents({ trajectoryId: tid, limit: 500 }),
    listFacts({ trajectoryId: tid, limit: 200, currentOnly: false }),
    listDecisions({ trajectoryId: tid, limit: 500 }),
  ]);
  return { trajectoryId: tid, events, facts, decisions };
}

/**
 * 删除某交易的全部记忆（测试/维护用；不常用）。
 * @param {number} trajectoryId Trajectory id.
 * @returns {Promise<number>} Total rows removed.
 */
export async function deleteByTrajectory(trajectoryId) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) return 0;
  const db = getDB();
  const factIds = (await db(FACT_TABLE).where({ trajectory_id: tid }).select('id')).map((r) => r.id);
  let removed = 0;
  if (factIds.length) {
    await db(RELATION_TABLE).where('from_fact_id', 'in', factIds).del();
    await db(RELATION_TABLE).where('to_fact_id', 'in', factIds).del();
  }
  removed += await db(FACT_TABLE).where({ trajectory_id: tid }).del();
  removed += await db(EVENT_TABLE).where({ trajectory_id: tid }).del();
  removed += await db(DECISION_TABLE).where({ trajectory_id: tid }).del();
  return removed;
}
