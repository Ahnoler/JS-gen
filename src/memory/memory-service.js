/**
 * 记忆系统服务门面（P0：摄取 / 检索 / 决策 / 审计 / 统计）。
 * 路由只允许调用本模块，禁止直接访问 DAO。
 */
import { state } from '../state.js';
import { getDB } from '../../config/database.js';
import * as memoryDao from './memory-dao.js';
import * as weightEngine from './weight-engine.js';
import { buildFactPack } from './fact-pack.js';
import {
  normalizeEventType,
  normalizeSource,
  normalizeStance,
  DECISION_TYPES,
  AUDIT_STATUSES,
} from './protocol.js';

function toNullableInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 通过 sessionId 解析交易 id（本地/执行机会话都挂在 state.sessions）。 */
export function resolveTrajectoryId({ trajectoryId = null, sessionId = '' } = {}) {
  const tid = toNullableInt(trajectoryId);
  if (tid != null && tid > 0) return tid;
  if (sessionId) {
    const session = state.sessions.get(String(sessionId));
    const dbTid = session?.dbTrajectoryId;
    if (dbTid != null) {
      const n = Number(dbTid);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

/** 规范化单条事件 → DB 行 + 附带 facts/decision。 */
function normalizeEvent(raw) {
  const ev = (raw && typeof raw === 'object') ? raw : {};
  const eventType = normalizeEventType(ev.eventType ?? ev.event_type ?? ev.type);
  const sessionId = String(ev.sessionId ?? ev.session_id ?? '');
  const trajectoryId = resolveTrajectoryId({
    trajectoryId: ev.trajectoryId ?? ev.trajectory_id,
    sessionId,
  });
  const payload = ev.payload ?? ev.data ?? null;

  const event = {
    trajectoryId,
    sessionId,
    phaseNumber: toNullableInt(ev.phaseNumber ?? ev.phase_number),
    stepNumber: toNullableInt(ev.stepNumber ?? ev.step_number),
    actionId: String(ev.actionId ?? ev.action_id ?? ''),
    eventType,
    payloadJson: payload == null ? null : (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    source: normalizeSource(ev.source),
    model: String(ev.model ?? ''),
    occurredAt: ev.occurredAt ?? ev.occurred_at ?? undefined,
  };

  const facts = Array.isArray(ev.facts)
    ? ev.facts.map((f) => normalizeFact(f, event))
    : [];

  const decision = ev.decision ?? ev.decisionRecord ?? null;
  const decisionRecord = decision
    ? normalizeDecision(decision, event)
    : null;

  return { event, facts, decisionRecord };
}

function normalizeFact(f, event) {
  const source = normalizeSource(f.source ?? event.source);
  const stance = normalizeStance(f.stance);
  const baseWeight = toNullableInt(f.baseWeight ?? f.base_weight);
  return {
    eventId: null, // 由 ingest 回填
    trajectoryId: event.trajectoryId,
    phaseNumber: toNullableInt(f.phaseNumber ?? f.phase_number) ?? event.phaseNumber,
    stepNumber: toNullableInt(f.stepNumber ?? f.step_number) ?? event.stepNumber,
    entity: String(f.entity ?? ''),
    attribute: String(f.attribute ?? 'value'),
    value: f.value == null ? null : String(f.value),
    factType: String(f.factType ?? f.fact_type ?? 'case_value'),
    source,
    stance,
    baseWeight: baseWeight ?? weightEngine.baseWeightFor(source),
    weight: weightEngine.initialWeight({
      source,
      stance,
      baseWeight: baseWeight ?? weightEngine.baseWeightFor(source),
    }),
    version: toNullableInt(f.version) ?? 1,
    createdBy: String(f.createdBy ?? f.created_by ?? ''),
  };
}

function toJsonString(v) {
  // 显式序列化 JSON 列：mysql2 会把数组参数展开为多值（insert 列数不匹配），
  // 对象参数则隐式 stringify —— 统一在此序列化，避免依赖驱动隐式行为。
  if (v == null) return null;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function normalizeDecision(d, event) {
  const decisionType = String(d.decisionType ?? d.decision_type ?? 'agent_step');
  const auditStatus = AUDIT_STATUSES.has(String(d.auditStatus ?? d.audit_status ?? ''))
    ? String(d.auditStatus ?? d.audit_status)
    : 'pending';
  return {
    trajectoryId: event.trajectoryId,
    phaseNumber: toNullableInt(d.phaseNumber ?? d.phase_number) ?? event.phaseNumber,
    stepNumber: toNullableInt(d.stepNumber ?? d.step_number) ?? event.stepNumber,
    decisionType: DECISION_TYPES.has(decisionType) ? decisionType : 'agent_step',
    model: String(d.model ?? event.model ?? ''),
    temperature: toNullableInt(d.temperature),
    promptHash: String(d.promptHash ?? d.prompt_hash ?? ''),
    inputFactIds: Array.isArray(d.inputFactIds ?? d.input_fact_ids)
      ? (d.inputFactIds ?? d.input_fact_ids)  // 保持数组，ingest 层再序列化
      : null,
    contextSnapshotId: toNullableInt(d.contextSnapshotId ?? d.context_snapshot_id),
    inputPreview: d.inputPreview ?? d.input_preview ?? null,
    outputJson: toJsonString(d.output ?? d.outputJson ?? d.output_json ?? null),
    confidence: toNullableInt(d.confidence),
    policyChecks: toJsonString(d.policyChecks ?? d.policy_checks ?? null),
    overridden: Boolean(d.overridden),
    finalAction: toJsonString(d.finalAction ?? d.final_action ?? null),
    auditStatus,
  };
}

/**
 * 批量摄取事件（P0 旁路写）。
 * 入参：{ events: [...] } 或直接数组。
 */
export async function ingestEvents(payload = {}) {
  const rawEvents = Array.isArray(payload) ? payload : payload?.events;
  if (!Array.isArray(rawEvents) || !rawEvents.length) {
    return { inserted: 0, facts: 0, decisions: 0, relations: 0 };
  }
  if (!(await memoryDao.isReady())) {
    return { inserted: 0, facts: 0, decisions: 0, relations: 0, skipped: 'schema-not-ready' };
  }

  const normalized = rawEvents.map(normalizeEvent);
  return getDBTransaction(async (trx) => {
    let inserted = 0;
    let facts = 0;
    let decisions = 0;
    const relations = [];

    for (const { event, facts: eventFacts, decisionRecord } of normalized) {
      const [eventId] = await memoryDao.insertEvents([event], trx);
      inserted += 1;

      let insertedFactIds = [];
      if (eventFacts.length) {
        const rows = eventFacts.map((f) => ({ ...f, eventId }));
        await memoryDao.insertFacts(rows, trx);
        // 多行 INSERT 只返回单 insertId，按 event_id 回查真实 id 用于关系建模
        insertedFactIds = await memoryDao.factIdsByEvent(eventId, trx);
        facts += insertedFactIds.length;
        // P1 冲突版本化：同 (trajectory, entity, attribute) 已有当前值 → 旧值
        // superseded + disputed（审计保留），新值 version = 旧.version + 1。
        // 排除同事件自身（同事件内多条同 entity 由上游去重，不互相覆盖）。
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const existing = await memoryDao.currentFactByEntity(
            event.trajectoryId,
            row.entity,
            row.attribute,
            trx,
            eventId,
          );
          if (existing && Number(existing.id) !== Number(insertedFactIds[i])) {
            await memoryDao.markFactSuperseded(existing.id, insertedFactIds[i], trx);
            await memoryDao.setFactVersion(insertedFactIds[i], (Number(existing.version) || 1) + 1, trx);
          }
        }
        // P0 关系建模：同事件内两两 co_occur（P1 扩展 fill_before_save 等）
        for (let i = 0; i < insertedFactIds.length; i++) {
          for (let j = i + 1; j < insertedFactIds.length; j++) {
            relations.push({
              trajectoryId: event.trajectoryId,
              fromFactId: insertedFactIds[i],
              toFactId: insertedFactIds[j],
              relationType: 'co_occur',
              strength: 0.1,
            });
          }
        }
      }

      if (decisionRecord) {
        // 上游未传 inputFactIds 时，用同事件内插入的事实回填（审计复现「模型依据了什么」）
        const hasInputFactIds = Array.isArray(decisionRecord.inputFactIds) && decisionRecord.inputFactIds.length;
        const record = {
          ...decisionRecord,
          inputFactIds: hasInputFactIds
            ? JSON.stringify(decisionRecord.inputFactIds)
            : (insertedFactIds.length ? JSON.stringify(insertedFactIds) : null),
        };
        const decisionId = await memoryDao.insertDecision(record, trx);
        if (decisionId != null) decisions += 1;
      }

      // P1：fill_before_save 关系建模 —— phase_done 到达时，把该阶段
      // 「已填写字段」事实与「结果」事实关联（方案 §5.2.3）
      if (event.eventType === 'phase_done' && event.phaseNumber != null) {
        try {
          const filled = await memoryDao.factsByPhaseAttribute(
            event.trajectoryId, event.phaseNumber, 'filled', trx,
          );
          const outcomes = await memoryDao.factsByPhaseAttribute(
            event.trajectoryId, event.phaseNumber, 'outcome', trx,
          );
          for (const f of filled) {
            for (const o of outcomes) {
              relations.push({
                trajectoryId: event.trajectoryId,
                fromFactId: Number(f.id),
                toFactId: Number(o.id),
                relationType: 'fill_before_save',
                strength: 1.0,
              });
            }
          }
        } catch (err) {
          console.warn('[memory] fill_before_save modeling skipped:', err?.message || err);
        }
      }
    }

    const relationCount = await memoryDao.upsertRelations(relations, trx);
    return { inserted, facts, decisions, relations: relationCount };
  });
}

async function getDBTransaction(fn) {
  return getDB().transaction(fn);
}

/**
 * 检索事实包（P0：结构化过滤 + 权重排序 + 预算裁剪）。
 * P2-2：传 functionId 且 AI_MEMORY_HISTORY 开启时，并入同功能历史成功交易
 * 的当前版本事实（source=history, stance=inferred, weight×0.5，排序自然靠后）。
 */
export async function retrieveFactPack({
  trajectoryId,
  phaseNumber = null,
  entity = '',
  limit = 50,
  maxChars = 2000,
  functionId = null,
} = {}) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) {
    return { facts: [], dropped: [], budget: { used: 0, max: maxChars, limit } };
  }
  const facts = await memoryDao.listFacts({
    trajectoryId: tid,
    phaseNumber: phaseNumber != null ? Number(phaseNumber) : null,
    entity,
    limit: Math.min(Number(limit) || 50, 200),
  });

  let historyFacts = [];
  try {
    const { AI_MEMORY_HISTORY } = await import('../../config/config.js');
    if (AI_MEMORY_HISTORY && Number.isFinite(Number(functionId)) && Number(functionId) > 0) {
      historyFacts = await memoryDao.listFactsByFunctionHistory(Number(functionId), tid, { limit: 20 });
    }
  } catch (err) {
    console.warn('[memory] history fact-pack skipped:', err?.message || err);
  }

  // P1：effective weight（存储权重 × 时间衰减 × 冲突惩罚）排序，事实包带出
  const now = Date.now();
  const ranked = [...facts, ...historyFacts]
    .map((f) => ({ ...f, effectiveWeight: weightEngine.computeWeight(f, now) }))
    .sort((a, b) => Number(b.effectiveWeight) - Number(a.effectiveWeight));
  return buildFactPack(ranked, { maxChars, limit });
}

/** 决策列表。 */
export async function listDecisions(filters = {}) {
  return memoryDao.listDecisions(filters);
}

/** 决策详情（回填 inputFacts 便于审计复现）。 */
export async function getDecision(id) {
  const decision = await memoryDao.getDecision(Number(id));
  if (!decision) return null;
  let inputFactIds = decision.inputFactIds;
  if (typeof inputFactIds === 'string') {
    try { inputFactIds = JSON.parse(inputFactIds); } catch { inputFactIds = []; }
  }
  if (!Array.isArray(inputFactIds)) inputFactIds = [];
  const inputFacts = await memoryDao.listFactsByIds(inputFactIds);
  return { ...decision, inputFactIds, inputFacts };
}

/** 审计汇总。 */
export async function auditSummary(trajectoryId) {
  return memoryDao.auditSummary(Number(trajectoryId));
}

/**
 * 离线复检（P0 只重算汇总；P1 实现 policy checks 逐条重放）。
 */
export async function runAudit(trajectoryId) {
  const summary = await memoryDao.auditSummary(Number(trajectoryId));
  return {
    ...summary,
    mode: 'summary-only',
    note: 'P0 仅汇总；P1 将逐条重放 policy checks',
  };
}

/** 交易记忆时间线。 */
export async function timeline(trajectoryId) {
  return memoryDao.timeline(Number(trajectoryId));
}

/** 全局统计。 */
export async function stats() {
  return memoryDao.stats();
}

/**
 * P1：把轨迹案例数据（analyze 解析 / 前端 POST 的 KV）摄取为
 * memory_fact —— source=requirement, stance=authoritative（不可被 LLM 覆盖），
 * 供事实包注入优先采用。entries 格式 {fieldKey, fieldValue} 或 {key, value}。
 */
export async function ingestCaseEntriesAsFacts(trajectoryId, entries) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0 || !Array.isArray(entries) || !entries.length) {
    return { inserted: 0 };
  }
  const facts = [];
  const seen = new Set();
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const entity = String(e.fieldKey ?? e.key ?? '').trim();
    if (!entity || seen.has(entity)) continue;
    seen.add(entity);
    const v = e.fieldValue ?? e.value;
    const value = v == null ? null : String(v);
    if (value == null || !value.trim()) continue; // 空值无信息量（与 extractCaseDataBlock 对齐）
    facts.push({
      entity,
      attribute: 'value',
      value,
      factType: 'requirement',
      source: 'requirement',
      stance: 'authoritative',
    });
  }
  if (!facts.length) return { inserted: 0 };
  return ingestEvents({
    events: [{
      eventType: 'system',
      trajectoryId: tid,
      source: 'requirement',
      payload: { kind: 'case_entries', count: facts.length },
      facts,
    }],
  });
}
