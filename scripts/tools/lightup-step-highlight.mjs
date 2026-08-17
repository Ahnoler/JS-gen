#!/usr/bin/env node
/**
 * PR-LOC-HL 步骤级高亮工具 — 数据加载 + 三维匹配纯函数（Task 1 数据层）。
 *
 * 用途：给定阶段长图（screenshot.kind='phase_highlight'）+ 同 phase 的录制步骤，
 * 把每步操作在长图内容坐标系上对应的控件框找出来，供后续任务在长图上逐步点亮/标注。
 * 新数据（element_json.bbox）直接使用步骤自带坐标；旧数据（无 bbox）回退为三维匹配
 * 阶段截图 metadata.elements[] 拿到 rect。
 *
 * 本文件只导出纯函数（数据层），不渲染 HTML，不含 CLI/main（后续任务补充）。
 *
 * 用法占位（后续任务据此加 CLI/渲染）：
 *   const db = getDB();                       // import { getDB } from '../../config/database.js'
 *   const data = await loadPhaseData(db, { trajectoryId: 38, phaseId: 629 });   // 或 { screenshotId }
 *   const resolved = resolveStepBoxes(data.steps, data.meta.elements);
 *   // resolved[i] = { step, boxes: [{ rect, source: 'bbox' | 'match' }] }
 */
import { getDB } from '../../config/database.js';

/** JSON 列归一化：MySQL JSON 可能是字符串或已解析对象；null/解析失败 → null。 */
function parseJson(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

/** rect 合法：四值有限且 x2>x1、y2>y1。 */
export function isLegalRect(rect) {
  return !!(
    rect &&
    Number.isFinite(rect.x1) &&
    Number.isFinite(rect.y1) &&
    Number.isFinite(rect.x2) &&
    Number.isFinite(rect.y2) &&
    rect.x2 > rect.x1 &&
    rect.y2 > rect.y1
  );
}

const normStr = (v) => String(v ?? '').trim();

/**
 * 归一化一条 trajectory_step 行 → { stepId, seq, actionType, label, kind, regionId, bbox, params }。
 * label = formLabel || text || matchedLabel（trim）；kind = target_kind；regionId = region_id；
 * bbox 仅在 element_json.bbox 合法（x2>x1 && y2>y1 && 四值有限）时保留；
 * params 由 params_json 归一化（对象或 null）。hasElementJson 标记 element_json 解析成功
 * （用于匹配率分母：null/空/解析失败的步骤计入 steps 数组但不参与匹配率）。
 */
export function normalizeStep(row, index) {
  const el = parseJson(row.element_json);
  const hasElementJson = !!(el && typeof el === 'object' && !Array.isArray(el));
  const label = hasElementJson ? normStr(el.formLabel ?? el.text ?? el.matchedLabel) : '';
  const kind = hasElementJson ? normStr(el.target_kind) : '';
  const regionId = hasElementJson ? normStr(el.region_id) : '';
  const bbox = hasElementJson && isLegalRect(el.bbox) ? el.bbox : null;
  const rawParams = parseJson(row.params_json);
  const params = rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams) ? rawParams : null;
  return {
    stepId: Number(row.id),
    seq: index,
    actionType: String(row.action_type ?? ''),
    label,
    kind,
    regionId,
    bbox,
    params,
    hasElementJson,
  };
}

/**
 * 加载数据：
 *   - screenshot：传 screenshotId 直查；否则 kind='phase_highlight' + trajectory_id
 *     （+ 可选 phaseId）按 id 倒序取第一条。
 *   - meta = metadata_json（contentWidth/contentHeight/elements[]）。
 *   - steps：trajectory_step 按 trajectory_phase_id 查询并 orderBy('id')；
 *     phaseId 未传但有 screenshotId 时，从 screenshot 行的 trajectory_phase_id 反查。
 * 返回 { screenshotId, meta, steps }（无截图时 { screenshotId: null, meta: null, steps: [] }）。
 */
export async function loadPhaseData(db, { trajectoryId, phaseId, screenshotId } = {}) {
  let row = null;
  let resolvedPhaseId = phaseId ? Number(phaseId) : null;

  if (screenshotId) {
    row = await db('screenshot').where({ id: Number(screenshotId) }).first();
  } else {
    let q = db('screenshot').where({ trajectory_id: Number(trajectoryId), kind: 'phase_highlight' });
    if (resolvedPhaseId) q = q.where({ trajectory_phase_id: resolvedPhaseId });
    row = await q.orderBy('id', 'desc').first();
  }
  if (!row) return { screenshotId: null, meta: null, steps: [] };

  if (!resolvedPhaseId && row.trajectory_phase_id) {
    resolvedPhaseId = Number(row.trajectory_phase_id);
  }

  const meta = parseJson(row.metadata_json) || {};

  const steps = [];
  if (resolvedPhaseId) {
    const stepRows = await db('trajectory_step')
      .select('id', 'action_type', 'params_json', 'element_json')
      .where({ trajectory_phase_id: resolvedPhaseId })
      .orderBy('id');
    for (const [i, r] of stepRows.entries()) {
      steps.push(normalizeStep(r, i));
    }
  }

  return { screenshotId: Number(row.id), meta, steps };
}

/**
 * 三维匹配（AND 语义）：step 与 element 的三维键 label→label、kind→kind、regionId→regionId，
 * 任一非空维度必须全等才算命中；维度为空则跳过该维。同 label 可能命中多个元素，
 * 取第一个 rect 合法（x2>x1 && y2>y1 && 四值有限）的元素。全空维度的 step 按未匹配处理。
 * 返回命中的 element，否则 null。
 */
export function matchStepToElement(step, elements) {
  if (!step.label && !step.kind && !step.regionId) return null;
  for (const el of elements) {
    if (!isLegalRect(el?.rect)) continue;
    if (step.label && normStr(el.label) !== step.label) continue;
    if (step.kind && normStr(el.kind) !== step.kind) continue;
    if (step.regionId && normStr(el.regionId) !== step.regionId) continue;
    return el;
  }
  return null;
}

/**
 * 每步 box 解析：bbox 直用（element_json.bbox 合法时）；无 bbox 走三维匹配，命中取 rect。
 * 返回 [{ step, boxes: [{ rect, source: 'bbox' | 'match' }] }]；未命中时 boxes 为空数组。
 */
export function resolveStepBoxes(steps, elements) {
  return steps.map((step) => {
    const boxes = [];
    if (isLegalRect(step.bbox)) {
      boxes.push({ rect: step.bbox, source: 'bbox' });
    } else {
      const el = matchStepToElement(step, elements);
      if (el) boxes.push({ rect: el.rect, source: 'match' });
    }
    return { step, boxes };
  });
}
