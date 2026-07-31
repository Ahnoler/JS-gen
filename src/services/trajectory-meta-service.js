/**
 * Trajectory shell / transaction meta: create empty, create with phases, LLM analyze, confirm.
 */
import { randomUUID } from 'crypto';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../dao/trajectory-phase-dao.js';
import * as functionDefDao from '../dao/function-def-dao.js';
import * as caseDataDao from '../dao/case-data-dao.js';
import { callLLM } from '../llm-utils.js';
import { getTrajectoryTree, getTrajectoryWithPhases } from './trajectory-query-service.js';

/** Section headers that introduce a case-data KV block in a requirement. */
const CASE_DATA_SECTION_RE = /^(案例数据|关键数据|测试数据|预设数据|用例数据)\s*[:：]?$/i;

/**
 * Deterministic extract of case KV from a requirement text block.
 * Recognizes a section like:
 *   案例数据
 *   客户名称：测试公司111
 *   证件号码：11111111111
 * @param {string} text
 * @returns {Array<{ fieldKey: string, fieldValue: string }>}
 */
export function extractCaseEntriesFromRequirement(text) {
  const lines = String(text || '').split(/\r?\n/);
  const raw = [];
  let inBlock = false;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    if (CASE_DATA_SECTION_RE.test(t)) {
      inBlock = true;
      continue;
    }

    // Same-line header: 「案例数据：客户名称：xxx」— treat rest as first KV if present
    const headerInline = t.match(/^(案例数据|关键数据|测试数据|预设数据|用例数据)\s*[:：]\s*(.+)$/i);
    if (headerInline) {
      inBlock = true;
      const rest = headerInline[2].trim();
      const m = rest.match(/^(.+?)\s*[:：=]\s*(.+)$/);
      if (m) raw.push({ fieldKey: m[1], fieldValue: m[2] });
      continue;
    }

    // Numbered step ends the case-data block
    if (inBlock && /^\d+[\.、\)]\s*/.test(t)) {
      inBlock = false;
    }
    if (!inBlock) continue;

    const m = t.match(/^(.+?)\s*[:：=]\s*(.+)$/);
    if (!m) continue;
    const fieldKey = m[1].trim();
    const fieldValue = m[2].trim();
    if (!fieldKey || !fieldValue) continue;
    if (/^(预期结果|步骤|阶段)$/.test(fieldKey)) continue;
    raw.push({ fieldKey, fieldValue });
  }

  return caseDataDao.normalizeCaseEntries(raw);
}

/**
 * Merge two case-entry lists; later list wins on duplicate fieldKey.
 * @param {...Array} lists
 */
function mergeCaseEntries(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const e of caseDataDao.normalizeCaseEntries(list || [])) {
      map.set(e.fieldKey, e);
    }
  }
  return [...map.values()];
}

function parseAnalyzePayload(raw) {
  const text = String(raw || '').trim();
  const tryObj = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    const phases = Array.isArray(obj.phases)
      ? obj.phases.map((p) => String(p).trim()).filter(Boolean)
      : null;
    const caseEntries = caseDataDao.normalizeCaseEntries(
      obj.caseEntries ?? obj.caseData ?? obj.entries ?? [],
    );
    if (phases) return { phases, caseEntries };
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

  // Fallback: bullet / numbered lines as phases only
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
            caseEntries: [],
          };
        }
      } catch {}
    }
  }

  return { phases, caseEntries: [] };
}

/**
 * Analyze a requirement description into phases + caseEntries.
 * Phase count follows the user's numbered steps — no stepLength target.
 * Returns: { phases: string[], caseEntries: { fieldKey, fieldValue }[] }. Does not persist.
 */
export async function analyzeRequirementToPhases({
  description,
  model,
} = {}) {
  const desc = String(description || '').trim();
  if (!desc) throw new Error('description is required');

  const fromText = extractCaseEntriesFromRequirement(desc);

  const prompt = [
    '你是资深业务流程拆解助手。',
    '请把下面“需求描述”拆分成：1) 按执行顺序的阶段步骤列表；2) 案例数据键值对。',
    '',
    '【阶段拆分规则 — 必须遵守】',
    '1. 阶段数量必须严格跟用户输入的分步走：用户写了几条操作步骤，就返回几条 phases，不要合并、不要拆细、不要增删步骤条数。',
    '2. 识别编号格式如「1、」「1.」「1)」「（1）」等；每条编号对应 phases 中的一项。',
    '3. 若用户未编号、只是连贯段落，再按自然操作边界拆分；有编号时禁止改写条数。',
    '4. 「案例数据 / 关键数据 / 测试数据」等段落不是操作步骤，不要计入 phases。',
    '5. 每个阶段必须是简短、可执行的中文操作描述，避免“分析/思考/总结”等元话术。',
    '',
    '【预期结果规则 — 必须遵守】',
    '1. 每个阶段字符串都必须包含「预期结果：…」。',
    '2. 若原文某步已写「预期结果」，必须原样保留其含义与关键表述，不得删改或弱化。',
    '3. 若原文某步没有「预期结果」，由你根据该步操作补写合理、可验证的预期结果（页面跳转、提示文案、抵达菜单等）。',
    '4. 建议格式：「{操作描述}。预期结果：{验收标准}」。',
    '',
    '【案例数据规则 — 必须遵守】',
    '1. 若需求中出现「案例数据 / 关键数据 / 测试数据」等段落，或明确写出「字段名：值 / 字段名=值」，提取为 caseEntries。',
    '2. caseEntries 每项为 {"fieldKey":"表单标签","fieldValue":"值"}；fieldKey 用表单可见标签（如「客户名称」「证件号码」），不要带冒号。',
    '3. 案例数据段落本身不要拆成阶段步骤；阶段里不要复述整段案例数据清单。',
    '4. 若某阶段操作里写了具体填值（如「客户名称填写测试」），也可提取到 caseEntries；与案例数据段重复时以案例数据段为准。',
    '5. 没有案例数据时返回 "caseEntries":[]。',
    '',
    '【示例】',
    '输入：',
    '1、点击客户管理，点击对公客户管理。',
    '2、新增一个对公潜在客户。',
    '',
    '关键数据',
    '客户名称：测试公司111',
    '证件号码：11111111111',
    '',
    '输出示例（用户写了 2 条操作 → phases 恰好 2 项）：',
    '{"phases":[',
    '"点击客户管理，点击对公客户管理。预期结果：抵达对公客户管理。",',
    '"新增一个对公潜在客户。预期结果：打开对公潜在客户新增表单。"',
    '],"caseEntries":[',
    '{"fieldKey":"客户名称","fieldValue":"测试公司111"},',
    '{"fieldKey":"证件号码","fieldValue":"11111111111"}',
    ']}',
    '',
    '输出必须是严格 JSON（不要 Markdown，不要解释），格式：{"phases":[...字符串...],"caseEntries":[{"fieldKey":"...","fieldValue":"..."},...]}。',
    '',
    '需求描述：',
    desc,
  ].join('\n');

  const modelId = model || 'deepseek-v4-flash';
  const content = await callLLM(prompt, modelId);
  const parsed = parseAnalyzePayload(content);

  // Text-block wins on key clash; LLM may add extras found inline
  const caseEntries = mergeCaseEntries(parsed.caseEntries, fromText);

  // Drop phases that are just case-data echoes
  const phases = (parsed.phases || [])
    .filter((p) => !CASE_DATA_SECTION_RE.test(p))
    .filter((p) => !/^(案例数据|关键数据)/.test(p));

  return { phases, caseEntries };
}

/**
 * Create empty trajectory shell under a function (for long-lived recording).
 */
export async function createEmptyTrajectory({
  functionId, task = '', model = '', name = '', systemAccountId = null,
} = {}) {
  let resolvedFunctionId = typeof functionId === 'number'
    ? functionId
    : await functionDefDao.getDefaultFunctionId();
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
    recordStatus: 'draft',
    steps: [],
  });
}

/**
 * Create a "transaction" (trajectory) shell with pre-defined phases.
 * `phases[]` can be string[] or {description: string}[].
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
} = {}) {
  const resolvedFunctionId = typeof functionId === 'number'
    ? functionId
    : await functionDefDao.getDefaultFunctionId();

  const parsed = Array.isArray(phases)
    ? phases
      .map((p) => (typeof p === 'string' ? { description: p } : p))
      .map((p) => (p && p.description != null ? String(p.description) : ''))
      .map((d) => d.trim())
      .filter(Boolean)
    : [];

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
    steps: [],
  });

  for (let i = 0; i < parsed.length; i++) {
    await trajectoryPhaseDao.create({
      phaseId: randomUUID(),
      phaseNumber: i + 1,
      trajectoryId: trajId,
      status: 'pending',
      description: parsed[i],
    });
  }

  const rawEntries = caseEntries ?? caseData;
  if (rawEntries !== undefined) {
    await caseDataDao.replaceEntriesForTrajectory(trajId, rawEntries);
  }

  return getTrajectoryWithPhases(trajId);
}

/**
 * Replace case KV entries bound to a trajectory.
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
  return getTrajectoryWithPhases(tid);
}

/**
 * Human confirmation of a trajectory (transaction-level).
 * confirmed=true  → recordStatus=completed
 * confirmed=false → recordStatus=draft (cancel confirmation)
 * Does NOT touch trajectory_step.confirmed (kept for future features).
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
  if (traj.recordStatus === 'recording' || traj.recordStatus === 'live') {
    const err = new Error(
      traj.recordStatus === 'recording'
        ? 'Cannot confirm while AI recording'
        : 'Cannot confirm while live (prepared); detach first',
    );
    err.statusCode = 409;
    throw err;
  }

  const want = !!confirmed;
  if (want) {
    await trajectoryDao.updateMeta(tid, {
      recordStatus: 'completed',
      isDone: true,
      isSuccessful: true,
    });
  } else {
    await trajectoryDao.updateMeta(tid, {
      recordStatus: 'draft',
      isDone: null,
      isSuccessful: null,
    });
  }

  const tree = await getTrajectoryTree(tid);
  return {
    trajectoryId: tid,
    recordStatus: tree?.recordStatus || (want ? 'completed' : 'draft'),
    confirmed: want,
    tree,
  };
}
