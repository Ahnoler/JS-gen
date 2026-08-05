/**
 * Trajectory shell / transaction meta: create empty, create with phases, LLM analyze, confirm.
 */
import { randomUUID } from 'crypto';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../dao/trajectory-phase-dao.js';
import * as systemDao from '../dao/system-dao.js';
import * as caseDataDao from '../dao/case-data-dao.js';
import { callLLM } from '../llm-utils.js';
import { getDB } from '../../config/database.js';
import { getTrajectoryTree, getTrajectoryWithPhases } from './trajectory-query-service.js';

/** Section headers that introduce a case-data block in a requirement. */
const CASE_DATA_SECTION_RE = /^(案例数据|关键数据|测试数据|预设数据|用例数据)\s*[:：]?$/i;
const CASE_DATA_HEADER_INLINE_RE = /^(案例数据|关键数据|测试数据|预设数据|用例数据)\s*[:：]/i;

/** Trailing AI value-hint blocks — must not drive phase-type classification. */
const BUSINESS_DATA_MARK_RE = /\n*【(?:业务数据|业务场景案例数据|预设案例数据)[^\n]*】[\s\S]*$/;

/**
 * Strip trailing 【业务数据】/ legacy case-data blocks from phase text.
 * @param {string} text
 * @returns {string}
 */
export function stripBusinessDataBlock(text) {
  return String(text || '').replace(BUSINESS_DATA_MARK_RE, '').trim();
}

/**
 * Whether this phase goal should receive 业务数据 for the AI.
 * Fill / modify / introduce only — not login, pure open-page navigate, or list query.
 * @param {string} phaseText
 * @returns {boolean}
 */
export function phaseNeedsBusinessData(phaseText) {
  const t = stripBusinessDataBlock(phaseText);
  if (!t) return false;

  const isLogin = /登录|登入/i.test(t)
    && !/新增|创建|录入|填写|修改|编辑|引入|校验/.test(t);
  if (isLogin) return false;

  const openPage = /预期结果[:：]?[^。；\n]{0,12}(?:打开|进入|抵达|到达)[^。；\n]{0,20}(?:页面|界面|弹窗|对话框)/.test(t);
  const beforeExpect = (t.split(/预期结果/)[0] || t);
  const actionHasWrite = /新增|创建|录入|填写|新建|添加|校验|开立|修改|编辑|更新|维护|引入|选人|选择客户|保存|提交/.test(beforeExpect);
  if (openPage && !actionHasWrite) return false;

  const isQuery = /查询|搜索|查找/.test(t)
    && !/新增|创建|录入|填写|修改|编辑|引入|保存|提交|校验/.test(t);
  if (isQuery) return false;

  if (/新增|创建|录入|填写|新建|添加|校验|开立|修改|编辑|更新|变更|维护/.test(t)) return true;
  if (/引入|选人|客户选择|选择客户|选择.*客户/.test(t)) return true;
  return false;
}

/**
 * Extract the raw「关键数据 / 案例数据 …」block from a *user requirement*.
 *
 * Semantically this is **业务数据** (what the user wants to use), not
 * **system_ref** (target-system captured / verified) and not legacy case_data
 * as the product home for system references. Section headers in NL often still
 * say「关键数据」or「案例数据」— treat the block as 业务数据.
 * Never persist this block into system_ref_*.
 *
 * Primary contract for AI fill: soft, relatively-structured notes; tolerate
 * wording drift; do not require colon-separated label=value.
 * @param {string} text
 * @returns {string} block including header, or '' if none
 */
export function extractCaseDataBlock(text) {
  const lines = String(text || '').split(/\r?\n/);
  const collected = [];
  let inBlock = false;

  for (const line of lines) {
    const t = line.trim();
    if (!inBlock) {
      if (CASE_DATA_SECTION_RE.test(t) || CASE_DATA_HEADER_INLINE_RE.test(t)) {
        inBlock = true;
        collected.push(line);
      }
      continue;
    }
    // Next numbered step ends the case-data block
    if (/^\d+[\.、\)]\s*/.test(t)) break;
    collected.push(line);
  }

  return collected.join('\n').trim();
}

/**
 * Best-effort KV parse of requirement **业务数据** (user wish-list text).
 *
 * Secondary to {@link extractCaseDataBlock}. Do not confuse with 案例数据
 * persisted from the system. Incomplete / fuzzy user wording is normal —
 * empty parse ≠ “no 业务数据”; the raw block still goes to the agent.
 *
 * @deprecated Prefer extractCaseDataBlock for AI fill context.
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

    const headerInline = t.match(/^(案例数据|关键数据|测试数据|预设数据|用例数据)\s*[:：]\s*(.+)$/i);
    if (headerInline) {
      inBlock = true;
      const rest = headerInline[2].trim();
      const m = rest.match(/^(.+?)\s*[:：=]\s*(.+)$/);
      if (m) raw.push({ fieldKey: m[1], fieldValue: m[2] });
      continue;
    }

    if (inBlock && /^\d+[\.、\)]\s*/.test(t)) {
      inBlock = false;
    }
    if (!inBlock) continue;

    const m = t.match(/^(.+?)\s*[:：=]\s*(.+)$/);
    if (!m) {
      // 无冒号/等号分隔的「引入」类案例数据：
      // 「法定责任人引入 朱桂武」→ {fieldKey: 法定责任人引入, fieldValue: 朱桂武}
      // （AI 录制实锤：introduce 放大镜场景模型因解析不出 KV 而用主表单值查询）
      const intro = t.match(/^(.*?引入)\s+(\S.*)$/);
      if (intro) {
        const fk = intro[1].trim();
        const fv = intro[2].trim();
        if (fk && fv) raw.push({ fieldKey: fk, fieldValue: fv });
      }
      continue;
    }
    const fieldKey = m[1].trim();
    const fieldValue = m[2].trim();
    if (!fieldKey || !fieldValue) continue;
    if (/^(预期结果|步骤|阶段)$/.test(fieldKey)) continue;
    raw.push({ fieldKey, fieldValue });
  }

  return caseDataDao.normalizeCaseEntries(raw);
}

/**
 * Append 业务数据 block only to fill / introduce phases (not navigate / login / query).
 * @param {string[]} phases
 * @param {string} caseBlock
 */
function appendCaseDataToPhases(phases, caseBlock) {
  const block = String(caseBlock || '').trim();
  if (!block || !Array.isArray(phases) || !phases.length) return phases || [];
  // Avoid「填写」in the mark — that keyword pollutes task_mode if strip ever fails.
  const suffix = `\n\n【业务数据 — 来自用户需求（非系统回写案例数据）；填表/引入时参考理解，按场景选用关键取值】\n${block}`;
  return phases.map((p) => {
    const text = String(p || '').trim();
    if (!text) return text;
    if (!phaseNeedsBusinessData(text)) return text;
    if (
      text.includes('【业务数据')
      || text.includes('【业务场景案例数据')
      || text.includes(block.slice(0, Math.min(40, block.length)))
    ) {
      return text;
    }
    return text + suffix;
  });
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
  functionId, task = '', model = '', name = '', systemAccountId = null,
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
      steps: [],
    }, client);

    let systemId = null;
    try {
      const { resolveAncestorSystemId } = await import('./hierarchy-service.js');
      systemId = await resolveAncestorSystemId(resolvedFunctionId);
    } catch {
      systemId = null;
    }

    for (let i = 0; i < parsed.length; i++) {
      let candidates = null;
      if (systemId) {
        try {
          const { fetchDisplayCandidatesForDescription } = await import('./special-element-service.js');
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
        const { ingestCaseEntriesAsFacts } = await import('../memory/memory-service.js');
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
    const { ingestCaseEntriesAsFacts } = await import('../memory/memory-service.js');
    await ingestCaseEntriesAsFacts(tid, entries);
  } catch (err) {
    console.warn('[trajectory] case-entry fact ingest skipped:', err?.message || err);
  }
  return getTrajectoryWithPhases(tid);
}

/**
 * Human confirmation of a trajectory (transaction-level).
 * confirmed=true  → recordStatus=completed
 * confirmed=false → recordStatus=draft (cancel confirmation)
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
