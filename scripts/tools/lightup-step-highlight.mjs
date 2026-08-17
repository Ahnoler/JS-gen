#!/usr/bin/env node
/**
 * PR-LOC-HL 步骤级高亮工具 — 数据加载 + 三维匹配 + 渲染 + CLI。
 *
 * 用途：给定阶段长图（screenshot.kind='phase_highlight'）+ 同 phase 的录制步骤，
 * 把每步操作在长图内容坐标系上对应的控件框找出来，在长图上逐步点亮/标注。
 * 新数据（element_json.bbox）直接使用步骤自带坐标；旧数据（无 bbox）回退为三维匹配
 * 阶段截图 metadata.elements[] 拿到 rect。
 *
 * 数据层 / 渲染层为纯函数（可 import，供 characterization 复用）；CLI 仅在直接执行时运行：
 *   node scripts/tools/lightup-step-highlight.mjs --trajectory 38 [--phase 629] [--width 1400]
 *   node scripts/tools/lightup-step-highlight.mjs --id 8734 [--width 1400]
 * 输出 tmp/lightup-steps-<screenshotId>.html 并打印统计。
 *
 * 用法：
 *   const db = getDB();                       // import { getDB } from '../../config/database.js'
 *   const data = await loadPhaseData(db, { trajectoryId: 38, phaseId: 629 });   // 或 { screenshotId }
 *   const resolved = resolveStepBoxes(data.steps, data.meta.elements);
 *   // resolved[i] = { step, boxes: [{ rect, source: 'bbox' | 'match' }] }
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/** 参数摘要：JSON 序列化 + 截断，供浮层展示（保持单行、长度可控）。 */
function paramsSummary(params) {
  if (params == null) return '';
  let s;
  try {
    s = JSON.stringify(params);
  } catch {
    s = String(params);
  }
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
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
 * width（可选）：stage 显示宽，默认 1400；坐标为 contentWidth → width 等比换算。
 * seq = resolved 下标 + 1（步骤序号从 1 开始）：
 *   - bbox 框：border 2px solid hsl(...)，徽标 "N"
 *   - match 框（fallback）：border 2px dashed hsl(...)，徽标 "NM"
 *   - boxes 空（无坐标）：不画框，步骤列表行加 no-box 置灰
 */
export function buildHtml({ b64, meta, resolved, width }) {
  const cw = Number(meta?.contentWidth) || 1;
  const ch = Number(meta?.contentHeight) || 1;
  const steps = Array.isArray(resolved) ? resolved : [];
  const W = Number(width) > 0 ? Number(width) : 1400;
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
        `<div class="box${dashed ? ' dashed' : ''}" data-step="${seq}" data-source="${b.source}" ` +
        `data-action="${escHtml(r.step?.actionType)}" data-label="${escHtml(r.step?.label)}" ` +
        `data-params="${escHtml(paramsSummary(r.step?.params))}" data-region="${escHtml(r.step?.regionId)}" ` +
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
<style>
  /* PR-LOC-HL 交互层（Task 3）：覆盖 pointer-events，新增筛选/浮层/高亮样式 */
  .stage .box { pointer-events: auto; cursor: pointer; }
  .box:hover { outline: 2px solid #ffeb3b; outline-offset: -2px; z-index: 6; }
  .box.flash { outline: 3px solid #ffeb3b; box-shadow: 0 0 12px rgba(255,235,59,.9); z-index: 6; }
  .step-row { cursor: pointer; }
  .step-row.active { background: #fff8e1; box-shadow: inset 3px 0 0 #f0c000; }
  .bar .ctrl { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #555; }
  .bar .ctrl label { display: inline-flex; align-items: center; gap: 2px; margin: 0 2px; }
  .bar button { font-size: 12px; padding: 2px 10px; cursor: pointer; }
  .tooltip { display: none; position: absolute; z-index: 50; background: rgba(20,20,20,.92); color: #eee;
             font-size: 12px; line-height: 1.5; padding: 8px 10px; border-radius: 4px; max-width: 240px;
             box-shadow: 0 2px 10px rgba(0,0,0,.35); pointer-events: none; }
  .tooltip.show { display: block; }
  .tooltip .tip-title { font-weight: 600; margin-bottom: 4px; }
  .tooltip .tip-row { display: flex; gap: 6px; }
  .tooltip .tip-row span { flex: none; color: #9ecbff; width: 48px; }
  .tooltip .tip-row b { font-weight: 400; word-break: break-all; }
</style>
</head>
<body>
<div class="bar">
  <b>步骤级高亮</b>
  <span class="dim">内容 ${cw}×${ch} · 步骤 ${steps.length}</span>
  <span class="legend">${legendColors}</span>
  <span class="legend"><span class="line-s"></span> bbox <span class="line-d"></span> 匹配</span>
  <span class="ctrl">筛选
    <label><input type="radio" name="filter" value="all" checked> 全部</label>
    <label><input type="radio" name="filter" value="bbox"> 仅 bbox</label>
    <label><input type="radio" name="filter" value="match"> 仅匹配</label>
    <label><input type="radio" name="filter" value="none"> 无坐标</label>
  </span>
  <span class="ctrl">不透明度 <input type="range" id="opacity" min="15" max="100" value="100"></span>
  <span class="ctrl"><button type="button" id="step-prev">上一步</button>
    <button type="button" id="step-next">下一步</button><span id="step-cur" class="dim"></span></span>
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
<script>
(function () {
  'use strict';
  // PR-LOC-HL 交互层（Task 3）：数据全部取自现有 DOM（.box data-step/data-source/…，.step-row data-step）。
  const stage = document.querySelector('.stage');
  const boxes = Array.prototype.slice.call(document.querySelectorAll('.stage .box'));
  const rows = Array.prototype.slice.call(document.querySelectorAll('.step-row'));
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  stage.appendChild(tip);

  const boxBySeq = new Map();
  const rowBySeq = new Map();
  boxes.forEach(function (b) { boxBySeq.set(Number(b.dataset.step), b); });
  rows.forEach(function (r) { rowBySeq.set(Number(r.dataset.step), r); });

  let curStep = 0;
  let flashTimer = null;

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function paramsText(box) {
    const raw = box.dataset.params || '';
    if (!raw) return '(无)';
    return raw.length > 140 ? raw.slice(0, 140) + '…' : raw;
  }

  // ---- 浮层（hover 详情：步骤号 / action / 标签 / 参数 / region / 来源）----
  function tipHtml(box) {
    return '<div class="tip-title">步骤 ' + esc(box.dataset.step) + '</div>'
      + '<div class="tip-row"><span>action</span><b>' + esc(box.dataset.action || '') + '</b></div>'
      + '<div class="tip-row"><span>标签</span><b>' + esc(box.dataset.label || '(无)') + '</b></div>'
      + '<div class="tip-row"><span>参数</span><b>' + esc(paramsText(box)) + '</b></div>'
      + '<div class="tip-row"><span>region</span><b>' + esc(box.dataset.region || '(空)') + '</b></div>'
      + '<div class="tip-row"><span>来源</span><b>' + esc(box.dataset.source || '') + '</b></div>';
  }
  function positionTip(box) {
    const sr = stage.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    const W = 240;
    let left = (br.left - sr.left) + br.width + 10;
    if (left + W > sr.width) left = (br.left - sr.left) - W - 10;
    left = Math.max(0, Math.min(left, Math.max(0, sr.width - W)));
    let top = (br.top - sr.top) - 8;
    top = Math.max(0, Math.min(top, Math.max(0, sr.height - 160)));
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function showTip(box) {
    tip.innerHTML = tipHtml(box);
    tip.classList.add('show');
    positionTip(box);
  }
  function hideTip() { tip.classList.remove('show'); }

  // ---- 列表联动：active 行 + 步进器状态 ----
  function setActiveRow(seq) {
    rows.forEach(function (r) { r.classList.remove('active'); });
    curStep = seq;
    const row = rowBySeq.get(seq);
    if (row) {
      row.classList.add('active');
      row.scrollIntoView({ block: 'nearest' });
    }
    const cur = document.getElementById('step-cur');
    if (cur) cur.textContent = seq ? (seq + ' / ' + rows.length) : '';
  }
  function centerBox(box) {
    box.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }
  function flashBox(seq) {
    const box = boxBySeq.get(seq);
    if (!box) return;
    box.classList.add('flash');
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { box.classList.remove('flash'); }, 1200);
    centerBox(box);
  }

  // 框 hover → 浮层 + 行高亮；框点击 → 行高亮（active）
  boxes.forEach(function (box) {
    box.addEventListener('mouseenter', function () { showTip(box); setActiveRow(Number(box.dataset.step)); });
    box.addEventListener('mousemove', function () { positionTip(box); });
    box.addEventListener('mouseleave', hideTip);
    box.addEventListener('click', function () { setActiveRow(Number(box.dataset.step)); hideTip(); });
  });

  // 行点击 → 框闪烁 + 若不可见滚动 stage 居中
  rows.forEach(function (row) {
    row.addEventListener('click', function () {
      const seq = Number(row.dataset.step);
      setActiveRow(seq);
      flashBox(seq);
    });
  });

  // ---- bar 筛选 radio：全部 / 仅 bbox / 仅匹配 / 无坐标 ----
  const filterRadios = Array.prototype.slice.call(document.querySelectorAll('input[name="filter"]'));
  function currentFilter() {
    for (let i = 0; i < filterRadios.length; i += 1) {
      if (filterRadios[i].checked) return filterRadios[i].value;
    }
    return 'all';
  }
  function applyFilter() {
    const f = currentFilter();
    boxes.forEach(function (box) {
      const src = box.dataset.source;
      const show = f === 'all' || (f === 'bbox' && src === 'bbox') || (f === 'match' && src === 'match');
      box.style.display = show ? '' : 'none';
    });
    rows.forEach(function (row) {
      const seq = Number(row.dataset.step);
      const b = boxBySeq.get(seq);
      let show;
      if (f === 'none') show = row.classList.contains('no-box');
      else if (f === 'bbox') show = !!(b && b.dataset.source === 'bbox');
      else if (f === 'match') show = !!(b && b.dataset.source === 'match');
      else show = true;
      row.style.display = show ? '' : 'none';
    });
  }
  filterRadios.forEach(function (r) { r.addEventListener('change', applyFilter); });

  // ---- 透明度滑块 ----
  const opacitySlider = document.getElementById('opacity');
  function applyOpacity() {
    const v = Number(opacitySlider.value) / 100;
    boxes.forEach(function (box) { box.style.opacity = String(v); });
  }
  opacitySlider.addEventListener('input', applyOpacity);

  // ---- 步进器：上一步 / 下一步（无框步骤仅高亮列表行）----
  const stepPrev = document.getElementById('step-prev');
  const stepNext = document.getElementById('step-next');
  function stepTo(seq) {
    if (seq < 1 || seq > rows.length) return;
    setActiveRow(seq);
    const box = boxBySeq.get(seq);
    if (box) centerBox(box);
  }
  stepPrev.addEventListener('click', function () { stepTo(curStep - 1); });
  stepNext.addEventListener('click', function () { stepTo(curStep + 1); });

  // ---- Escape：关浮层 + 清高亮 ----
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      hideTip();
      rows.forEach(function (r) { r.classList.remove('active'); });
      curStep = 0;
      const cur = document.getElementById('step-cur');
      if (cur) cur.textContent = '';
    }
  });

  applyFilter();
  applyOpacity();
})();
</script>
</body>
</html>`;
}

/* ============================================================
 * Task 4 — CLI 入口（直接执行时才跑 main，import 复用不触发）。
 * ============================================================ */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 直接执行判断：node 运行本文件 → true；被 import（如 characterization）→ false。 */
function isDirectRun() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  const entry = resolve(process.argv[1]);
  if (process.platform === 'win32') return self.toLowerCase() === entry.toLowerCase();
  return self === entry;
}

/**
 * CLI 主入口：定位截图 → 加载数据 → 解析步骤框 → 生成 tmp/lightup-steps-<id>.html → 打印统计。
 *
 * 参数：
 *   --id <screenshotId>      直查截图
 *   --trajectory <id>        kind='phase_highlight' 按 id 倒序取最新一张
 *   --phase <phaseId>        （可选）配合 --trajectory 限定阶段
 *   --width <px>             （可选，默认 1400）stage 显示宽，传给 buildHtml
 *
 * 无截图 / metadata 无 elements / 参数非法 → 报错返回 1（非 0 退出）。
 * export 便于 import 复用；返回值即退出码（0 成功 / 1 失败）。
 */
export async function main(argv = process.argv.slice(2)) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--id' || argv[i] === '--trajectory' || argv[i] === '--phase' || argv[i] === '--width') {
      opts[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    }
  }

  const screenshotId = opts.id != null ? Number(opts.id) : null;
  const trajectoryId = opts.trajectory != null ? Number(opts.trajectory) : null;
  const phaseId = opts.phase != null ? Number(opts.phase) : null;
  const width = opts.width != null ? Number(opts.width) : 1400;

  if (screenshotId == null && trajectoryId == null) {
    console.error('用法：--id <screenshotId> 或 --trajectory <id> [--phase <phaseId>] [--width <px>]');
    return 1;
  }
  const badNum = [];
  if (screenshotId != null && !Number.isFinite(screenshotId)) badNum.push('--id');
  if (trajectoryId != null && !Number.isFinite(trajectoryId)) badNum.push('--trajectory');
  if (phaseId != null && !Number.isFinite(phaseId)) badNum.push('--phase');
  if (width != null && !(Number.isFinite(width) && width > 0)) badNum.push('--width');
  if (badNum.length) {
    console.error(`参数必须是正数：${badNum.join(' / ')}`);
    return 1;
  }

  const db = getDB();
  try {
    // --phase 兼容两种语义：优先按 phase_number 匹配（用户习惯），未命中再按 phase id 兜底。
    let resolvedPhaseId = phaseId;
    if (trajectoryId != null && phaseId != null) {
      const p = await db('trajectory_phase')
        .select('id')
        .where({ trajectory_id: trajectoryId, phase_number: phaseId })
        .first();
      if (p) resolvedPhaseId = p.id;
    }
    const data = await loadPhaseData(db, { trajectoryId, phaseId: resolvedPhaseId, screenshotId });
    if (!data.screenshotId) {
      console.error('未找到阶段截图（--id 无此行，或 --trajectory 无 kind="phase_highlight" 截图）');
      return 1;
    }
    const elements = data.meta?.elements;
    if (!Array.isArray(elements) || elements.length === 0) {
      console.error(`screenshot #${data.screenshotId} 无 elements（metadata 为空或非 phase 截图）`);
      return 1;
    }

    const row = await db('screenshot').where({ id: data.screenshotId }).first();
    if (!row || !row.image_data) {
      console.error(`screenshot #${data.screenshotId} 无 image_data，无法生成 HTML`);
      return 1;
    }

    const resolved = resolveStepBoxes(data.steps, elements);
    const html = buildHtml({ b64: row.image_data.toString('base64'), meta: data.meta, resolved, width });

    const out = join(ROOT, 'tmp', `lightup-steps-${data.screenshotId}.html`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html, 'utf8');

    const total = resolved.length;
    const bboxCount = resolved.filter((r) => r.boxes.some((b) => b.source === 'bbox')).length;
    const matchCount = resolved.filter((r) => r.boxes.some((b) => b.source === 'match')).length;
    const noCoordCount = resolved.filter((r) => r.boxes.length === 0).length;

    console.log(`已生成: ${out}`);
    console.log(`screenshot #${data.screenshotId} | 内容 ${data.meta.contentWidth}×${data.meta.contentHeight} | stage 宽 ${width}px`);
    console.log(`steps 总数: ${total}`);
    console.log(`有 bbox 步数: ${bboxCount}`);
    console.log(`fallback 匹配步数: ${matchCount}`);
    console.log(`无坐标步数: ${noCoordCount}`);
    return 0;
  } finally {
    await db.destroy();
  }
}

if (isDirectRun()) {
  main().then(
    (code) => { process.exitCode = code; },
    (err) => {
      console.error(err);
      process.exitCode = 1;
    },
  );
}
