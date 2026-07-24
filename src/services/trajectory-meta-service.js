/**
 * Trajectory shell / transaction meta: create empty, create with phases, LLM analyze, confirm.
 */
import { randomUUID } from 'crypto';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../dao/trajectory-phase-dao.js';
import * as functionDefDao from '../dao/function-def-dao.js';
import { callLLM } from '../llm-utils.js';
import { getTrajectoryTree } from './trajectory-query-service.js';

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

  return trajectoryDao.getById(trajId);
}

/**
 * Analyze a requirement description into an ordered phase list.
 * Returns: string[] (phase descriptions). Does not persist.
 */
export async function analyzeRequirementToPhases({
  description,
  stepLength,
  model,
} = {}) {
  const desc = String(description || '').trim();
  if (!desc) throw new Error('description is required');

  const targetCount = Number(stepLength);
  const n = Number.isFinite(targetCount) && targetCount > 0
    ? Math.max(2, Math.min(20, Math.floor(targetCount)))
    : 6;

  const prompt = [
    '你是资深业务流程拆解助手。',
    '请把下面“需求描述”拆分成按执行顺序的阶段步骤列表。',
    `阶段数量目标: ${n}（可在 ${Math.max(2, n - 1)} ~ ${Math.max(2, n + 1)} 范围内浮动，但尽量接近；若需求已按条编号，优先按原文条数拆分）。`,
    '每个阶段必须是简短、可执行的中文操作描述，避免“分析/思考/总结”等元话术。',
    '',
    '【预期结果规则 — 必须遵守】',
    '1. 每个阶段字符串都必须包含「预期结果：…」。',
    '2. 若原文某步已写「预期结果」，必须原样保留其含义与关键表述，不得删改或弱化。',
    '3. 若原文某步没有「预期结果」，由你根据该步操作补写合理、可验证的预期结果（页面跳转、提示文案、抵达菜单等）。',
    '4. 建议格式：「{操作描述}。预期结果：{验收标准}」。',
    '',
    '【示例】',
    '输入：',
    '1.点击客户管理，点击对公客户管理。',
    '2.新增一个信贷潜在客户，点击保存。预期结果：点击保存后，跳转到信贷潜在客户基本信息填写页面。',
    '3.点击法定代表人/负责人证件号码的引入按钮，客户名称 填写 测试，点击查询，选择一个客户，点击确认。',
    '4.填写信贷潜在客户的基本信息，点击保存。预期结果：点击保存后，提示操作成功。',
    '输出 phases 示例：',
    '["点击客户管理，点击对公客户管理。预期结果：抵达对公客户管理。",',
    '"新增一个信贷潜在客户并保存。预期结果：点击保存后，跳转到信贷潜在客户基本信息填写页面。",',
    '"点击法定代表人/负责人证件号码的引入按钮，客户名称 填写 测试，点击查询，选择一个客户，点击确认。预期结果：完成法定代表人的引入流程。",',
    '"填写信贷潜在客户的基本信息，点击保存。预期结果：点击保存后，提示操作成功。"]',
    '',
    '输出必须是严格 JSON（不要 Markdown，不要解释），格式：{"phases":[...字符串...]}.',
    '',
    '需求描述：',
    desc,
  ].join('\n');

  const modelId = model || 'deepseek-v4-flash';
  const content = await callLLM(prompt, modelId);
  const raw = String(content || '').trim();

  // 1) Try strict JSON first
  try {
    const obj = JSON.parse(raw);
    const phases = obj?.phases;
    if (Array.isArray(phases)) return phases.map((p) => String(p).trim()).filter(Boolean);
  } catch {}

  // 2) Extract JSON-ish substring if wrapped
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const slice = raw.slice(firstBrace, lastBrace + 1);
      const obj = JSON.parse(slice);
      const phases = obj?.phases;
      if (Array.isArray(phases)) return phases.map((p) => String(p).trim()).filter(Boolean);
    } catch {}
  }

  // 3) Fallback: parse array lines / bullets
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const phases = [];
  for (const line of lines) {
    // strip leading numbering/bullets
    const cleaned = line
      .replace(/^[-*•]\s*/, '')
      .replace(/^\d+[\.\)]\s*/, '')
      .replace(/^\"|\"$/g, '')
      .trim();
    if (!cleaned) continue;
    if (/^phases?\s*[:=]\s*\[/i.test(cleaned)) continue;
    if (/^\]$/.test(cleaned)) continue;
    phases.push(cleaned.replace(/,$/, ''));
  }

  // If still empty, last attempt: regex for "phases":[...]
  if (!phases.length) {
    const m = raw.match(/\"phases\"\s*:\s*\[(.*)\]/s);
    if (m) {
      try {
        const arrJson = `[${m[1]}]`;
        const arr = JSON.parse(arrJson);
        if (Array.isArray(arr)) return arr.map((p) => String(p).trim()).filter(Boolean);
      } catch {}
    }
  }

  // Enforce at least 1 and cap
  return phases.slice(0, 20);
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
