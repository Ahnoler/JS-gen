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

/** 写入前确认表已存在（schema 未迁移时返回 false，调用方决定降级）。 */
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

/** 批量插入事件，返回 id 列表。 */
export async function insertEvents(events, trx = null) {
  if (!Array.isArray(events) || !events.length) return [];
  const db = trx || getDB();
  const rows = events.map((e) => toDbRow(e));
  const ids = await db(EVENT_TABLE).insert(rows);
  return ids.map((x) => Number(x));
}

/** 批量插入事实（含权重默认值已在 service 计算）。 */
export async function insertFacts(facts, trx = null) {
  if (!Array.isArray(facts) || !facts.length) return [];
  const db = trx || getDB();
  const rows = facts.map((f) => toDbRow(f));
  const ids = await db(FACT_TABLE).insert(rows);
  return ids.map((x) => Number(x));
}

/** 当前版本事实（superseded_by IS NULL）按实体+属性查找（冲突版本化用）。 */
export async function currentFactByEntity(trajectoryId, entity, attribute, trx = null, excludeEventId = null) {
  const db = trx || getDB();
  const q = db(FACT_TABLE)
    .where({ trajectory_id: Number(trajectoryId), entity: String(entity), attribute: String(attribute) })
    .whereNull('superseded_by');
  if (excludeEventId != null) q.whereNot({ event_id: Number(excludeEventId) });
  return q.orderBy('id', 'desc').first();
}

/** 标记旧事实被新版本取代：superseded_by + disputed stance + 按 disputed 重算存储权重。 */
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

/** 设置事实版本号（新版本在旧版本基础上 +1）。 */
export async function setFactVersion(id, version, trx = null) {
  const db = trx || getDB();
  await db(FACT_TABLE).where({ id: Number(id) }).update({ version: Number(version) });
  return true;
}

/** 按阶段+属性查当前版本事实（fill_before_save 建模用）。 */
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

/** 按来源事件取回事实 id 列表（多行 INSERT 仅返回单 insertId，需按 event_id 回查）。 */
export async function factIdsByEvent(eventId, trx = null) {
  const db = trx || getDB();
  const rows = await db(FACT_TABLE)
    .where({ event_id: eventId })
    .select('id')
    .orderBy('id');
  return rows.map((r) => Number(r.id));
}

/** 批量插入/更新关系（冲突则提升 strength）。 */
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

/** 插入一条决策记录。 */
export async function insertDecision(decision, trx = null) {
  if (!decision) return null;
  const db = trx || getDB();
  const [id] = await db(DECISION_TABLE).insert(toDbRow(decision));
  return Number(id);
}

/** 更新决策审计状态。 */
export async function updateDecisionAudit(id, { auditStatus } = {}) {
  if (!Number.isFinite(Number(id))) return false;
  const n = await getDB()(DECISION_TABLE)
    .where({ id: Number(id) })
    .update({ audit_status: String(auditStatus || 'pending') });
  return n > 0;
}

/** 事件列表（按交易/会话/阶段/类型过滤）。 */
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

/** 事实列表（默认只取当前版本 superseded_by IS NULL）。 */
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

/** 决策列表。 */
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

/** 决策详情。 */
export async function getDecision(id) {
  const row = await getDB()(DECISION_TABLE).where({ id: Number(id) }).first();
  return row ? fromDbRow(row) : null;
}

/** 交易审计汇总。 */
export async function auditSummary(trajectoryId) {
  const tid = Number(trajectoryId);
  const db = getDB();
  if (!Number.isFinite(tid) || tid <= 0) {
    return { trajectoryId: null, total: 0, byStatus: {}, overridden: 0 };
  }
  const rows = await db(DECISION_TABLE).where({ trajectory_id: tid });
  const byStatus = { pending: 0, passed: 0, failed: 0 };
  let overridden = 0;
  for (const r of rows) {
    byStatus[r.audit_status] = (byStatus[r.audit_status] || 0) + 1;
    if (r.overridden) overridden += 1;
  }
  return { trajectoryId: tid, total: rows.length, byStatus, overridden };
}

/** 全局统计（P0 简单计数，P1 扩展延迟/命中率）。 */
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

/** 交易记忆时间线：事件 + 事实 + 决策。 */
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

/** 删除某交易的全部记忆（测试/维护用；不常用）。 */
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
