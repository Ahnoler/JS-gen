/**
 * Trajectory shell / transaction meta: create empty, create with phases, LLM analyze, confirm.
 */
import { randomUUID } from 'crypto';
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../../dao/trajectory-phase-dao.js';
import * as systemDao from '../../dao/system-dao.js';
import * as businessDataDao from '../../dao/business-data-dao.js';
import { callLLM } from '../../llm-utils.js';
import { LLM_MODEL } from '#config/config.js';
import { getDB } from '#config/database.js';
import { getTrajectoryTree, getTrajectoryWithPhases } from './trajectory-query-service.js';
import {
  BUSINESS_DATA_SECTION_RE,
  extractBusinessEntriesFromRequirement,
} from './trajectory-text-extract.js';

export {
  stripBusinessDataBlock,
  phaseNeedsBusinessData,
  extractBusinessDataBlock,
  extractSuccessGatesBlock,
  extractBusinessEntriesFromRequirement,
} from './trajectory-text-extract.js';

/**
 * 容错提取 "phases":[...] 内的字符串元素。
 * LLM 输出的 JSON 字符串值里常带未转义的原始换行（长句折行），直接 JSON.parse
 * 会失败；这里按引号/深度边界做顶层元素切分，再对每个元素做最小修复。
 * @param {string} arrText "phases":[...] 方括号内的原文
 * @returns {string[]} 阶段文本列表
 */
function extractPhaseElementsLoose(arrText) {
  const elements = [];
  let cur = '';
  let inStr = false;
  let escape = false;
  let depth = 0;
  for (const ch of arrText) {
    if (inStr) {
      cur += ch;
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; cur += ch; continue; }
    if (ch === '[') { depth += 1; cur += ch; continue; }
    if (ch === ']') { depth -= 1; cur += ch; continue; }
    if (ch === ',' && depth === 0) { elements.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) elements.push(cur);

  const phases = [];
  for (const el of elements) {
    const raw = el.trim();
    if (!raw) continue;
    try {
      const v = JSON.parse(raw);
      if (typeof v === 'string' && v.trim()) { phases.push(v.trim()); continue; }
    } catch {}
    // 最小修复：剥离外层引号 → 还原常见转义 → 把字符串内的裸换行折行折叠为空格
    let s = raw.replace(/^"|"$/g, '')
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
    s = s.replace(/\s*\n\s*/g, ' ').trim();
    if (s) phases.push(s);
  }
  return phases;
}

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

  // JSON.parse 失败（多为字符串值内裸换行）：按引号边界容错提取 phases 数组
  const arrMatch = text.match(/"phases"\s*:\s*\[([\s\S]*)\]/);
  if (arrMatch) {
    const loose = extractPhaseElementsLoose(arrMatch[1]);
    if (loose.length) return { phases: loose };
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
    if (/^\{?\s*"phases?"\s*[:=]\s*\[/i.test(cleaned)) continue;
    if (/^businessEntries?\s*[:=]/i.test(cleaned)) continue;
    if (BUSINESS_DATA_SECTION_RE.test(cleaned)) continue;
    if (/^[\]}]+,?$/.test(cleaned)) continue;
    phases.push(cleaned.replace(/,$/, ''));
  }

  return { phases };
}

export { parseAnalyzePayload };

/**
 * Analyze a requirement into phases. Business-data block is NOT split into businessEntries;
 * the raw block is appended to every phase for the agent to use when filling forms.
 * Returns: { phases: string[] }. Does not persist.
 * @param {object} opts 选项
 * @param {string} opts.description 需求描述
 * @param {string} [opts.model] 模型名
 * @returns {Promise<{ phases: string[] }>} 阶段列表
 */
export async function analyzeRequirementToPhases({
  description,
  model,
} = {}) {
  const desc = String(description || '').trim();
  if (!desc) throw new Error('description is required');

  const prompt = [
    '你是资深业务流程拆解助手。',
    '请把下面“需求描述”拆分成按执行顺序的阶段步骤列表（phases）。',
    '',
    '【阶段拆分规则 — 必须遵守】',
    '1. 阶段数量必须严格跟用户输入的分步走：用户写了几条操作步骤，就返回几条 phases，不要合并、不要拆细、不要增删步骤条数。',
    '2. 识别编号格式如「1、」「1.」「1)」「（1）」等；每条编号对应 phases 中的一项。',
    '3. 若用户未编号、只是连贯段落，再按自然操作边界拆分；有编号时禁止改写条数。',
    '4. 「业务数据 / 关键数据 / 测试数据」等段落不是操作步骤，不要计入 phases、不要拆成键值对。',
    '5. 「硬性成功门闩/门槛」「禁止…」等约束性规则行（如【硬性成功门闩——…】、【禁止点击…】）是全局约束，不是操作步骤：既不计入 phases，也不要把这类文字复制进任何 phase 字符串（系统会在录制时作为全局约束另行下发给执行端）。',
    '6. 每个阶段必须是简短、可执行的中文操作描述，避免“分析/思考/总结”等元话术。',
    '7. 不要在 phases 字符串里复制任何业务数据（业务数据由系统在录制时统一注入到任务上下文，不写入阶段描述）。',
    '',
    '【预期结果规则 — 必须遵守】',
    '1. 每个阶段字符串都必须包含「预期结果：…」，这是下游阶段分类的硬标记，不得省略或改用其他写法（如「验收标准：」）。',
    '2. 若原文某步已写「预期结果」，必须原样保留其含义与关键表述，不得删改或弱化。',
    '3. 若原文某步没有「预期结果」，由你根据该步操作补写合理、可验证的预期结果（页面跳转、提示文案、抵达菜单等）。',
    '4. 强制格式：「{操作描述}。预期结果：{验收标准}」。验收标准若描述页面跳转，必须使用「打开 / 进入 / 抵达 / 到达 … 页面（界面/弹窗/列表）」的措辞，禁止改写成其他句式。',
    '',
    '【示例】',
    '输入：',
    '1、点击客户管理，点击对公客户管理。',
    '2、新增一个对公潜在客户。',
    '',
    '【硬性成功门槛——任一门槛未满足不得结束本阶段】',
    '- 禁止点击「OCR识别」及一切影像入口。',
    '',
    '关键数据',
    '对公客户基本信息：',
    '法定责任人的客户名称：朱桂武',
    '客户标签：',
    '',
    '输出示例（用户写了 2 条操作 → phases 恰好 2 项；业务数据与硬性成功门槛等约束行都不出现在 JSON 里）：',
    '{"phases":[',
    '"点击客户管理，点击对公客户管理。预期结果：抵达对公客户管理页面。",',
    '"新增一个对公潜在客户。预期结果：打开对公潜在客户新增表单。"',
    ']}',
    '',
    '输出必须是严格 JSON（不要 Markdown，不要解释），格式：{"phases":[...字符串...]}。',
    'JSON 字符串值内禁止出现换行：每个 phase 字符串必须写在一行内，长句也不要折行。',
    '',
    '需求描述：',
    desc,
  ].join('\n');

  const modelId = model || LLM_MODEL;
  const content = await callLLM(prompt, modelId);
  const parsed = parseAnalyzePayload(content);

  // Drop phases that are just business-data echoes
  let phases = (parsed.phases || [])
    .filter((p) => !BUSINESS_DATA_SECTION_RE.test(p))
    .filter((p) => !/^(案例数据|关键数据)/.test(p))
    // 门槛/门闩/禁止类约束行不是操作步骤（执行侧由 boundary gates + success_gates_block 处理），兜底剔除
    .filter((p) => !/^【?\s*(硬性成功门[槛闩]|禁止|不得|严禁)/.test(p));

  // 业务数据不再逐条追加进 phase.description（落库保持干净目标文本）；
  // 录制时由执行机 format_business_data_hint 在需要的阶段的任务文本后统一注入一次。

  // P1：analyze 附带结构化 KV（extractBusinessEntriesFromRequirement 规则解析，非 LLM 拆解）。
  // 前端创建轨迹时透传 → legacy business_data_entry 落库 + memory_fact(requirement/authoritative)。
  // 这是用户需求业务数据的 KV 投影，不是 system_ref（目标系统回写参考值）。
  // 禁止把本结果写入 system_ref_data / system_ref_entry。
  // 注意：必须是 KV 数组（normalizeBusinessEntries 对非数组返回 []）。
  return { phases, businessEntries: extractBusinessEntriesFromRequirement(desc) };
}

/**
 * Create empty trajectory shell under a function (for long-lived recording).
 * @param {object} opts 选项
 * @param {number|string} opts.functionId 功能节点 id
 * @param {string} [opts.task] 需求描述
 * @param {string} [opts.model] 模型名
 * @param {string} [opts.name] 轨迹名称
 * @param {number|null} [opts.systemAccountId] 系统账号 id
 * @param {string|null} [opts.paasUserId] PaaS 用户 id
 * @returns {Promise<object>} 创建的轨迹实体
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
 * @param {object} opts 选项
 * @param {number|string} opts.functionId 功能节点 id
 * @param {string} [opts.name] 轨迹名称
 * @param {string} [opts.requirement] 需求描述
 * @param {Array<string|{description: string}>} [opts.phases] 阶段列表
 * @param {string} [opts.model] 模型名
 * @param {number|null} [opts.systemAccountId] 系统账号 id
 * @param {Array} [opts.businessEntries] 业务数据 KV
 * @param {Array} [opts.businessData] 业务数据 KV（businessEntries 别名）
 * @param {boolean} [opts.requireFunctionId] 禁止静默回退默认功能节点
 * @param {number|null} [opts.batchJobId] 批量任务 id
 * @param {string|null} [opts.paasUserId] PaaS 用户 id
 * @param {string|null} [opts.reqModuleKey] KB req module key (provenance)
 * @param {string|null} [opts.reqSourcePath] KB source document path (provenance)
 * @param {string|null} [opts.reqChapterRef] KB chapter reference (provenance)
 * @param {string|null} [opts.reqAtomKey] Stable propose atom key (provenance)
 * @param {number} [opts.reqAtomSeq] Force re-commit sequence within (module, atom)
 * @param {import('knex').Knex|null} [opts.trx] 可选事务
 * @returns {Promise<object>} 创建的轨迹实体（含阶段）
 */
export async function createTransactionWithPhases({
  functionId,
  name = '',
  requirement = '',
  phases = [],
  model = '',
  systemAccountId = null,
  businessEntries = undefined,
  businessData = undefined,
  requireFunctionId = false,
  batchJobId = null,
  paasUserId = null,
  reqModuleKey = null,
  reqSourcePath = null,
  reqChapterRef = null,
  reqAtomKey = null,
  reqAtomSeq = 0,
  kbFlowRef = null,
  kbFlowNodeId = null,
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
      reqModuleKey,
      reqSourcePath,
      reqChapterRef,
      reqAtomKey,
      reqAtomSeq,
      kbFlowRef,
      kbFlowNodeId,
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

    const rawEntries = businessEntries ?? businessData;
    if (rawEntries !== undefined) {
      await businessDataDao.replaceEntriesForTrajectory(trajId, rawEntries, client);
    }

    // P1：结构化业务数据 → memory_fact（requirement/authoritative，供事实包注入）。
    // 独立连接摄取（不参与本事务原子性），失败仅告警不阻塞创建。
    if (Array.isArray(rawEntries) && rawEntries.length) {
      try {
        const { ingestBusinessEntriesAsFacts } = await import('../../memory/memory-service.js');
        await ingestBusinessEntriesAsFacts(trajId, rawEntries);
      } catch (err) {
        console.warn('[trajectory] business-entry fact ingest skipped:', err?.message || err);
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
 * Replace business KV entries bound to a trajectory (legacy business_data_entry).
 * These are NOT system_ref rows — use system-ref-service for target-system
 * verified references. Requirement 业务数据 should prefer task text / 【业务数据】.
 * @param {number} trajectoryId 轨迹 id
 * @param {Array} entries 业务数据 KV 数组
 * @returns {Promise<object>} 更新后的轨迹实体（含阶段）
 */
export async function setTrajectoryBusinessEntries(trajectoryId, entries) {
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
  await businessDataDao.replaceEntriesForTrajectory(tid, entries);
  // P1：同步摄取为 authoritative 事实（事实包注入用）
  try {
    const { ingestBusinessEntriesAsFacts } = await import('../../memory/memory-service.js');
    await ingestBusinessEntriesAsFacts(tid, entries);
  } catch (err) {
    console.warn('[trajectory] business-entry fact ingest skipped:', err?.message || err);
  }
  return getTrajectoryWithPhases(tid);
}

/**
 * Human confirmation of a trajectory (transaction-level).
 * confirmed=true  → recordStatus=completed
 * confirmed=false → recordStatus=recorded (cancel confirmation)
 * Does NOT touch trajectory_step.confirmed (回放确认 flag, not trajectory confirm).
 * @param {number} trajectoryId 轨迹 id
 * @param {boolean} [confirmed] 是否确认
 * @returns {Promise<object>} 更新后的轨迹实体
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
  const want = !!confirmed;
  // 状态流转 V3：待确认(recorded) 可人工确认到 已确认(completed)；
  // 录制中(recording)也允许人工确认——只写持久基线，不打断录制会话，
  // 会话结束时 finishTransientRecording 以该基线收尾（显式成功不再降级回待确认）。
  // 只有 已确认(completed) 可取消确认回到 待确认(recorded)。未录制/录制异常不可直接确认。
  if (want && traj.recordStatus !== 'recorded' && traj.recordStatus !== 'recording') {
    const err = new Error('Only a recorded (待确认) or recording (录制中) trajectory can be confirmed');
    err.statusCode = 409;
    throw err;
  }
  if (!want && traj.recordStatus !== 'completed' && traj.recordStatus !== 'recording') {
    const err = new Error('Only a completed (已确认) trajectory can cancel confirmation');
    err.statusCode = 409;
    throw err;
  }

  if (want) {
    if (traj.recordStatus === 'recording') {
      // 录制中确认：record_status 保持 recording（前端仍显示录制中），
      // 持久基线直接置为已确认，录制正常/异常/恢复结束时都不会丢失该确认。
      await trajectoryDao.updateMeta(tid, {
        persistentRecordStatus: 'completed',
        isDone: true,
        isSuccessful: true,
      });
    } else {
      await trajectoryDao.setPersistentRecordStatus(tid, 'completed');
      await trajectoryDao.updateMeta(tid, {
        isDone: true,
        isSuccessful: true,
      });
    }
  } else if (traj.recordStatus === 'recording') {
    // 录制中取消确认：与录制中确认互为逆操作，持久基线回待确认，不打断录制
    await trajectoryDao.updateMeta(tid, {
      persistentRecordStatus: 'recorded',
      isDone: null,
      isSuccessful: null,
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
