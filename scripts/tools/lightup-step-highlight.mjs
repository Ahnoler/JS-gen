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

/* ============================================================
 * Task 2 — 渲染层（纯函数）：自包含 HTML 生成。
 * ============================================================ */

/** 像素格式化：保留 2 位小数，避免超长浮点。 */
function fmtPx(v) {
  return Math.round(Number(v) * 100) / 100;
}

/**
 * 坐标换算：内容坐标系 → 显示像素。图片按 contentWidth/contentHeight 比例显示
 * （浏览器等比拉伸），scale = 显示宽 / contentWidth，x/y 同比例。
 */
export function coordX(value, contentWidth, displayWidth) {
  return (Number(value) / Number(contentWidth)) * Number(displayWidth);
}
export function coordY(value, contentWidth, displayWidth) {
  return (Number(value) / Number(contentWidth)) * Number(displayWidth);
}

/** HTML 转义（步骤列表列文本用）。 */
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 步骤序号 → 边框/徽标色：hsl((seq*47)%360, 70%, 45%)。 */
function stepColor(seq) {
  return `hsl(${(seq * 47) % 360}, 70%, 45%)`;
}

/**
 * 生成自包含 HTML：阶段长图按 contentWidth/contentHeight 比例显示，每步一组绝对定位框
 * （同色边框 + 序号徽标），左侧 sticky 步骤列表列，bar 内含图例。
 *
 * resolved 为 resolveStepBoxes 的返回值：[{ step, boxes: [{ rect, source: 'bbox'|'match' }] }]。
 * seq = resolved 下标 + 1（步骤序号从 1 开始）：
 *   - bbox 框：border 2px solid hsl(...)，徽标 "N"
 *   - match 框（fallback）：border 2px dashed hsl(...)，徽标 "NM"
 *   - boxes 空（无坐标）：不画框，步骤列表行加 no-box 置灰
 */
export function buildHtml({ b64, meta, resolved }) {
  const cw = Number(meta?.contentWidth) || 1;
  const ch = Number(meta?.contentHeight) || 1;
  const steps = Array.isArray(resolved) ? resolved : [];
  const W = 1400;
  const H = Math.max(1, Math.round((W * ch) / cw));

  // 每步一组框；记录真正画出来的框数（防御非法 rect 跳过）。
  const renderedCount = new Array(steps.length).fill(0);
  const boxParts = [];
  steps.forEach((r, i) => {
    const seq = i + 1;
    const color = stepColor(seq);
    const boxes = Array.isArray(r.boxes) ? r.boxes : [];
    for (const b of boxes) {
      if (!isLegalRect(b.rect)) continue;
      renderedCount[i] += 1;
      const dashed = b.source === 'match';
      const left = coordX(b.rect.x1, cw, W);
      const top = coordY(b.rect.y1, cw, W);
      const width = Math.max(2, coordX(b.rect.x2, cw, W) - left);
      const height = Math.max(2, coordY(b.rect.y2, cw, W) - top);
      boxParts.push(
        `<div class="box${dashed ? ' dashed' : ''}" data-step="${seq}" ` +
        `style="left:${fmtPx(left)}px;top:${fmtPx(top)}px;width:${fmtPx(width)}px;height:${fmtPx(height)}px;` +
        `border:2px ${dashed ? 'dashed' : 'solid'} ${color};">` +
        `<span class="badge" style="background:${color}">${seq}${dashed ? 'M' : ''}</span></div>`,
      );
    }
  });

  // 左侧 sticky 步骤列表列：步骤号 + action_type + label，data-step 关联。
  const listParts = steps.map((r, i) => {
    const seq = i + 1;
    const hasBox = renderedCount[i] > 0;
    const action = escHtml(r.step?.actionType);
    const label = escHtml(r.step?.label);
    return (
      `<div class="step-row${hasBox ? '' : ' no-box'}" data-step="${seq}">` +
      `<span class="seq" style="background:${stepColor(seq)}">${seq}</span>` +
      `<span class="action">${action}</span>` +
      `<span class="label">${label}</span></div>`
    );
  });

  // bar 图例：步骤色示例（前 8 个有框步骤的色块）+ 实线=bbox / 虚线=匹配。
  const sampleSeqs = [];
  for (let i = 0; i < steps.length && sampleSeqs.length < 8; i += 1) {
    if (renderedCount[i] > 0) sampleSeqs.push(i + 1);
  }
  const legendColors = sampleSeqs.length
    ? sampleSeqs
        .map((s) => `<span class="lg-item" title="步骤 ${s}"><i style="background:${stepColor(s)}"></i>${s}</span>`)
        .join('')
    : '<span class="dim">无匹配步骤</span>';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>步骤级高亮</title>
<style>
  body { margin: 0; background: #f5f5f5; font-family: system-ui, sans-serif; }
  .bar { position: sticky; top: 0; z-index: 20; background: #fff; padding: 8px 16px;
         border-bottom: 1px solid #ddd; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .bar b { font-size: 14px; }
  .bar .dim { color: #888; font-size: 12px; }
  .legend { font-size: 12px; color: #555; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  .legend .lg-item { display: inline-flex; align-items: center; gap: 3px; }
  .legend i { display: inline-block; width: 12px; height: 12px; border-radius: 2px; }
  .legend .line-s, .legend .line-d { display: inline-block; width: 20px; vertical-align: middle; }
  .legend .line-s { border-top: 3px solid #666; }
  .legend .line-d { border-top: 3px dashed #666; }
  .main { display: flex; align-items: flex-start; }
  .steps-col { position: sticky; top: 56px; width: 280px; flex: none; background: #fff;
               border-right: 1px solid #ddd; max-height: calc(100vh - 64px); overflow: auto; }
  .steps-col h4 { margin: 10px 12px 6px; font-size: 13px; color: #666; }
  .step-row { display: flex; align-items: center; gap: 8px; padding: 5px 12px; font-size: 12px;
              border-bottom: 1px solid #f0f0f0; }
  .step-row .seq { flex: none; width: 20px; height: 20px; border-radius: 3px; color: #fff; font-size: 11px;
                   display: inline-flex; align-items: center; justify-content: center; }
  .step-row .action { flex: none; color: #333; font-family: ui-monospace, SFMono-Regular, monospace; }
  .step-row .label { color: #666; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .step-row.no-box { opacity: .45; background: #fafafa; }
  .wrap { flex: 1; padding: 16px; display: flex; justify-content: center; overflow: auto; }
  .stage { position: relative; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.15); }
  .stage img { display: block; width: 100%; height: 100%; }
  .stage .box { position: absolute; box-sizing: border-box; pointer-events: none; }
  .stage .box .badge { position: absolute; left: -1px; top: -1px; color: #fff; font-size: 11px; line-height: 1;
                       padding: 2px 4px; border-radius: 0 0 2px 0; white-space: nowrap; }
</style>
</head>
<body>
<div class="bar">
  <b>步骤级高亮</b>
  <span class="dim">内容 ${cw}×${ch} · 步骤 ${steps.length}</span>
  <span class="legend">${legendColors}</span>
  <span class="legend"><span class="line-s"></span> bbox <span class="line-d"></span> 匹配</span>
</div>
<div class="main">
  <div class="steps-col">
    <h4>步骤列表（${steps.length}）</h4>
    ${listParts.join('')}
  </div>
  <div class="wrap">
    <div class="stage" style="width:${W}px;height:${H}px;">
      <img src="data:image/png;base64,${b64 ?? ''}" alt="阶段长图">
      ${boxParts.join('')}
    </div>
  </div>
</div>
</body>
</html>`;
}
