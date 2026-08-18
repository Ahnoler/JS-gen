/**
 * Trajectory shell / transaction meta: create empty, create with phases, LLM analyze, confirm.
 */
import { randomUUID } from 'crypto';
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../../dao/trajectory-phase-dao.js';
import * as systemDao from '../../dao/system-dao.js';
import * as caseDataDao from '../../dao/case-data-dao.js';
import { callLLM } from '../../llm-utils.js';
import { getDB } from '../../../config/database.js';
import { getTrajectoryTree, getTrajectoryWithPhases } from './trajectory-query-service.js';
import {
  CASE_DATA_SECTION_RE,
  extractCaseDataBlock,
  extractCaseEntriesFromRequirement,
  appendCaseDataToPhases,
} from './trajectory-text-extract.js';

export {
  stripBusinessDataBlock,
  phaseNeedsBusinessData,
  extractCaseDataBlock,
  extractCaseEntriesFromRequirement,
} from './trajectory-text-extract.js';

function parseAnalyzePayload(raw) {
  const text = String(raw || '').trim();
  const tryObj = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    const phases = Array.isArray(obj.phases)
      ? obj.phases.map((p) => String(p).trim()).filter(Boolean)
      : null;
    if (phases) return { phases };
    return null;
  };

  try {
    const hit = tryObj(JSON.parse(text));
    if (hit) return hit;
  } catch {}

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const hit = tryObj(JSON.parse(text.slice(firstBrace, lastBrace + 1)));
      if (hit) return hit;
    } catch {}
  }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const phases = [];
  for (const line of lines) {
    const cleaned = line
      .replace(/^[-*•]\s*/, '')
      .replace(/^\d+[\.\)]\s*/, '')
      .replace(/^"|"$/g, '')
      .trim();
    if (!cleaned) continue;
    if (/^phases?\s*[:=]\s*\[/i.test(cleaned)) continue;
    if (/^caseEntries?\s*[:=]/i.test(cleaned)) continue;
    if (CASE_DATA_SECTION_RE.test(cleaned)) continue;
    if (/^\]$/.test(cleaned)) continue;
    phases.push(cleaned.replace(/,$/, ''));
  }

  if (!phases.length) {
    const m = text.match(/"phases"\s*:\s*\[(.*)\]/s);
    if (m) {
      try {
        const arr = JSON.parse(`[${m[1]}]`);
        if (Array.isArray(arr)) {
          return {
            phases: arr.map((p) => String(p).trim()).filter(Boolean),
          };
        }
      } catch {}
    }
  }

  return { phases };
}

/**
 * Analyze a requirement into phases. Case-data block is NOT split into caseEntries;
 * the raw block is appended to every phase for the agent to use when filling forms.
 * Returns: { phases: string[] }. Does not persist.
 */
export async function analyzeRequirementToPhases({
  description,
  model,
} = {}) {
  const desc = String(description || '').trim();
  if (!desc) throw new Error('description is required');

  const caseBlock = extractCaseDataBlock(desc);

  const prompt = [
    '你是资深业务流程拆解助手。',
    '请把下面“需求描述”拆分成按执行顺序的阶段步骤列表（phases）。',
    '',
    '【阶段拆分规则 — 必须遵守】',
    '1. 阶段数量必须严格跟用户输入的分步走：用户写了几条操作步骤，就返回几条 phases，不要合并、不要拆细、不要增删步骤条数。',
    '2. 识别编号格式如「1、」「1.」「1)」「（1）」等；每条编号对应 phases 中的一项。',
    '3. 若用户未编号、只是连贯段落，再按自然操作边界拆分；有编号时禁止改写条数。',
    '4. 「案例数据 / 关键数据 / 测试数据」等段落不是操作步骤，不要计入 phases、不要拆成键值对。',
    '5. 每个阶段必须是简短、可执行的中文操作描述，避免“分析/思考/总结”等元话术。',
    '6. 不要在 phases 字符串里复制整段案例数据（系统会另行附加）。',
    '',
    '【预期结果规则 — 必须遵守】',
    '1. 每个阶段字符串都必须包含「预期结果：…」。',
    '2. 若原文某步已写「预期结果」，必须原样保留其含义与关键表述，不得删改或弱化。',
    '3. 若原文某步没有「预期结果」，由你根据该步操作补写合理、可验证的预期结果（页面跳转、提示文案、抵达菜单等）。',
    '4. 建议格式：「{操作描述}。预期结果：{验收标准}」。',
    '',
    '【示例】',
    '输入：',
    '1、点击客户管理，点击对公客户管理。',
    '2、新增一个对公潜在客户。',
    '',
    '关键数据',
    '对公客户基本信息：',
    '法定责任人的客户名称：朱桂武',
    '客户标签：',
    '',
    '输出示例（用户写了 2 条操作 → phases 恰好 2 项；案例数据不出现在 JSON 里）：',
    '{"phases":[',
    '"点击客户管理，点击对公客户管理。预期结果：抵达对公客户管理。",',
    '"新增一个对公潜在客户。预期结果：打开对公潜在客户新增表单。"',
    ']}',
    '',
    '输出必须是严格 JSON（不要 Markdown，不要解释），格式：{"phases":[...字符串...]}。',
    '',
    '需求描述：',
    desc,
  ].join('\n');

  const modelId = model || 'deepseek-v4-flash';
  const content = await callLLM(prompt, modelId);
  const parsed = parseAnalyzePayload(content);

  // Drop phases that are just case-data echoes
  let phases = (parsed.phases || [])
    .filter((p) => !CASE_DATA_SECTION_RE.test(p))
    .filter((p) => !/^(案例数据|关键数据)/.test(p));

  // Append raw business-scenario case data to each phase (for AI fill reference)
  phases = appendCaseDataToPhases(phases, caseBlock);

  // P1：analyze 附带结构化 KV（extractCaseEntriesFromRequirement 规则解析，非 LLM 拆解）。
  // 前端创建轨迹时透传 → legacy case_data_entry 落库 + memory_fact(requirement/authoritative)。
  // 这是用户需求业务数据的 KV 投影，不是 system_ref（目标系统回写参考值）。
  // 禁止把本结果写入 system_ref_data / system_ref_entry。
  // 注意：必须是 KV 数组（normalizeCaseEntries 对非数组返回 []），raw 文本块
  // 仅用于 appendCaseDataToPhases，不作为 caseEntries。
  return { phases, caseEntries: extractCaseEntriesFromRequirement(desc) };
}

/**
 * Create empty trajectory shell under a function (for long-lived recording).
 */
export async function createEmptyTrajectory({
  functionId, task = '', model = '', name = '', systemAccountId = null, paasUserId = null,
} = {}) {
  let resolvedFunctionId = typeof functionId === 'number'
    ? functionId
    : await systemDao.getDefaultFunctionId();
  return trajectoryDao.save({
    name: String(name || '').trim(),
    trajectoryLog: null,
    task: task || '',
    model: model || '',
    stepCount: 0,
    phaseCount: 0,
    isDone: null,
    isSuccessful: null,
    url: '',
    functionId: resolvedFunctionId,
    systemAccountId: systemAccountId != null ? Number(systemAccountId) : null,
    paasUserId,
    recordStatus: 'draft',
    steps: [],
  });
}

/**
 * Create a "transaction" (trajectory) shell with pre-defined phases.
 * `phases[]` can be string[] or {description: string}[].
 * When `trx` is provided, all writes share that transaction (caller commits).
 * Pass `requireFunctionId: true` to forbid silent default-function fallback.
 */
export async function createTransactionWithPhases({
  functionId,
  name = '',
  requirement = '',
  phases = [],
  model = '',
  systemAccountId = null,
  caseEntries = undefined,
  caseData = undefined,
  requireFunctionId = false,
  batchJobId = null,
  paasUserId = null,
  trx = null,
} = {}) {
  let resolvedFunctionId;
  if (typeof functionId === 'number' && Number.isFinite(functionId) && functionId > 0) {
    resolvedFunctionId = functionId;
  } else if (requireFunctionId) {
    const err = new Error('functionId is required');
    err.statusCode = 400;
    throw err;
  } else {
    resolvedFunctionId = await systemDao.getDefaultFunctionId();
  }

  const parsed = Array.isArray(phases)
    ? phases
      .map((p) => (typeof p === 'string' ? { description: p } : p))
      .map((p) => (p && p.description != null ? String(p.description) : ''))
      .map((d) => d.trim())
      .filter(Boolean)
    : [];

  const run = async (client) => {
    const trajId = await trajectoryDao.save({
      name: String(name || '').trim(),
      trajectoryLog: null,
      task: String(requirement || '').trim(),
      model: model || '',
      stepCount: 0,
      phaseCount: parsed.length,
      isDone: null,
      isSuccessful: null,
      url: '',
      functionId: resolvedFunctionId,
      systemAccountId: systemAccountId != null ? Number(systemAccountId) : null,
      recordStatus: 'draft',
      batchJobId: batchJobId ?? null,
      paasUserId,
      steps: [],
    }, client);

    let systemId = null;
    try {
      const { resolveAncestorSystemId } = await import('../hierarchy-service.js');
      systemId = await resolveAncestorSystemId(resolvedFunctionId);
    } catch {
      systemId = null;
    }

    for (let i = 0; i < parsed.length; i++) {
      let candidates = null;
      if (systemId) {
        try {
          const { fetchDisplayCandidatesForDescription } = await import('../special-element-service.js');
          candidates = await fetchDisplayCandidatesForDescription(systemId, parsed[i], 3);
        } catch {
          candidates = [];
        }
      }
      await trajectoryPhaseDao.create({
        phaseId: randomUUID(),
        phaseNumber: i + 1,
        trajectoryId: trajId,
        status: 'pending',
        description: parsed[i],
        specialElementCandidatesJson: candidates?.length ? JSON.stringify(candidates) : null,
      }, client);
    }

    const rawEntries = caseEntries ?? caseData;
    if (rawEntries !== undefined) {
      await caseDataDao.replaceEntriesForTrajectory(trajId, rawEntries, client);
    }

    // P1：结构化案例数据 → memory_fact（requirement/authoritative，供事实包注入）。
    // 独立连接摄取（不参与本事务原子性），失败仅告警不阻塞创建。
    if (Array.isArray(rawEntries) && rawEntries.length) {
      try {
        const { ingestCaseEntriesAsFacts } = await import('../../memory/memory-service.js');
        await ingestCaseEntriesAsFacts(trajId, rawEntries);
      } catch (err) {
        console.warn('[trajectory] case-entry fact ingest skipped:', err?.message || err);
      }
    }

    return trajId;
  };

  if (trx) {
    const trajId = await run(trx);
    // Caller owns the transaction; return id only when trx is external
    return trajId;
  }

  const trajId = await getDB().transaction((t) => run(t));
  return getTrajectoryWithPhases(trajId);
}

/**
 * Replace case KV entries bound to a trajectory (legacy case_data_entry).
 * These are NOT system_ref rows — use system-ref-service for target-system
 * verified references. Requirement 业务数据 should prefer task text / 【业务数据】.
 * @param {number} trajectoryId
 * @param {Array} entries
 */
export async function setTrajectoryCaseEntries(trajectoryId, entries) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) {
    const err = new Error('Invalid trajectory id');
    err.statusCode = 400;
    throw err;
  }
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }
  await caseDataDao.replaceEntriesForTrajectory(tid, entries);
  // P1：同步摄取为 authoritative 事实（事实包注入用）
  try {
    const { ingestCaseEntriesAsFacts } = await import('../../memory/memory-service.js');
    await ingestCaseEntriesAsFacts(tid, entries);
  } catch (err) {
    console.warn('[trajectory] case-entry fact ingest skipped:', err?.message || err);
  }
  return getTrajectoryWithPhases(tid);
}

/**
 * Human confirmation of a trajectory (transaction-level).
 * confirmed=true  → recordStatus=completed
 * confirmed=false → recordStatus=recorded (cancel confirmation)
 * Does NOT touch trajectory_step.confirmed (回放确认 flag, not trajectory confirm).
 */
export async function confirmTrajectory(trajectoryId, confirmed = true) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) {
    const err = new Error('Invalid trajectory id');
    err.statusCode = 400;
    throw err;
  }
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }
  if (traj.recordStatus === 'recording' || traj.recordStatus === 'failed') {
    const err = new Error(
      traj.recordStatus === 'recording'
        ? 'Cannot confirm while recording'
        : 'Cannot confirm a failed trajectory — retry or reset first',
    );
    err.statusCode = 409;
    throw err;
  }

  const want = !!confirmed;
  if (want) {
    await trajectoryDao.setPersistentRecordStatus(tid, 'completed');
    await trajectoryDao.updateMeta(tid, {
      isDone: true,
      isSuccessful: true,
    });
  } else {
    await trajectoryDao.updateMetaIf(tid, {
      recordStatus: 'recorded',
      isDone: null,
      isSuccessful: null,
    }, { recordStatusIn: ['completed'] });
    // keep persistent_record_status baseline in sync (recorded)
    await trajectoryDao.updateMetaIf(tid, {
      persistentRecordStatus: 'recorded',
    }, { recordStatusIn: ['recorded'] });
  }

  const tree = await getTrajectoryTree(tid);
  return {
    trajectoryId: tid,
    recordStatus: tree?.recordStatus || (want ? 'completed' : 'recorded'),
    confirmed: want,
    tree,
  };
}
