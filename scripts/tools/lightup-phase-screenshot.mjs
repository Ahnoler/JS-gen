#!/usr/bin/env node
/**
 * 阶段长图控件点亮工具（MVP 可视化）。
 *
 * 从 MySQL 拿一张阶段长图（screenshot.image_data）+ metadata_json（elements[]），
 * 生成一个自包含 HTML：长图按内容坐标系显示，每个控件画框点亮（半透明底色 + 边框），
 * 悬停/点击显示控件详情（kind / label / regionId / rect）。
 *
 * 坐标换算：rect 为内容坐标系（0..contentWidth × 0..contentHeight）；
 * 图片按 contentWidth/contentHeight 比例显示（浏览器拉伸），框 = rect × (显示宽 / contentWidth)。
 *
 * 用法：
 *   node scripts/tools/lightup-phase-screenshot.mjs --id 8655
 *   node scripts/tools/lightup-phase-screenshot.mjs --trajectory 108 --phase 623
 *   node scripts/tools/lightup-phase-screenshot.mjs --trajectory 108            # 该交易最新阶段截图
 *   node scripts/tools/lightup-phase-screenshot.mjs --trajectory 108 --width 1000
 *   node scripts/tools/lightup-phase-screenshot.mjs --v3 payload.json           # 兼容 V3.0 groups / V3.1 flat
 *
 * 输出：tmp/lightup-<screenshotId>.html（浏览器打开即可）
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDB } from '../../config/database.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** kind → 点亮颜色（仅视觉区分，非契约） */
const KIND_COLORS = {
  menu: '#9e9e9e',
  form_input: '#2196f3',
  form_select: '#ff9800',
  form_date: '#9c27b0',
  form_radio: '#009688',
  form_checkbox: '#00bcd4',
  form_tree_select: '#ff5722',
  button: '#4caf50',
  icon: '#795548',
  table_row_button: '#cddc39',
  tree_node: '#8bc34a',
  tab: '#e91e63',
  submenu: '#9e9e9e',
};
const KIND_COLOR = (k) => KIND_COLORS[k] || '#607d8b';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml({ b64, meta, screenshotId, steps, imageUrl = '' }) {
  const elements = (Array.isArray(meta.elements) ? meta.elements : [])
    .filter((e) => e && e.rect
      && Number.isFinite(e.rect.x1) && Number.isFinite(e.rect.y1)
      && Number.isFinite(e.rect.x2) && Number.isFinite(e.rect.y2)
      && e.rect.x2 > e.rect.x1 && e.rect.y2 > e.rect.y1);
  const cw = Number(meta.contentWidth) || 1;
  const ch = Number(meta.contentHeight) || 1;
  const stepTexts = (Array.isArray(steps) ? steps : [])
    .map((s) => String(s.label || '').trim()).filter(Boolean);

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>阶段长图控件点亮 #${screenshotId}</title>
<style>
  body { margin: 0; background: #f5f5f5; font-family: system-ui, sans-serif; }
  .bar { position: sticky; top: 0; z-index: 20; background: #fff; padding: 8px 16px;
         border-bottom: 1px solid #ddd; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .bar b { font-size: 14px; }
  .bar .dim { color: #888; font-size: 12px; }
  .bar label { font-size: 12px; color: #555; display: flex; align-items: center; gap: 4px; }
  .wrap { padding: 16px; display: flex; justify-content: center; }
  .stage { position: relative; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.15); }
  .stage img { display: block; width: 100%; height: 100%; }
  .stage .box { position: absolute; border: 1.5px solid; border-radius: 2px;
                box-sizing: border-box; cursor: pointer; transition: box-shadow .15s, opacity .15s; }
  .stage .box:hover { box-shadow: 0 0 0 2px #ffeb3b, 0 0 10px rgba(0,0,0,.4); z-index: 5; }
  .stage .box.acted { border-color: #f44336 !important; box-shadow: 0 0 0 2px #f44336, 0 0 8px rgba(244,67,54,.5); z-index: 4; }
  .stage .box .tag { position: absolute; left: 0; top: 0; transform: translateY(-100%);
                     background: rgba(0,0,0,.75); color: #fff; font-size: 11px; line-height: 1.4;
                     padding: 1px 4px; border-radius: 2px; white-space: nowrap; pointer-events: none;
                     display: none; max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
  .stage .box:hover .tag { display: block; }
  .side { position: fixed; right: 0; top: 0; bottom: 0; width: 320px; background: #fff;
          border-left: 1px solid #ddd; padding: 12px; overflow: auto; transform: translateX(100%);
          transition: transform .2s; z-index: 30; box-shadow: -4px 0 12px rgba(0,0,0,.1); }
  .side.open { transform: translateX(0); }
  .side h3 { margin: 0 0 8px; font-size: 14px; }
  .side dl { margin: 0; font-size: 12px; }
  .side dt { color: #888; margin-top: 6px; }
  .side dd { margin: 0; }
  .legend { font-size: 12px; color: #555; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  .legend i { display: inline-block; width: 12px; height: 12px; border-radius: 2px; margin-right: 2px; vertical-align: -1px; }
</style>
</head>
<body>
<div class="bar">
  <b>阶段长图控件点亮 #${screenshotId}</b>
  <span class="dim">elements ${elements.length} · 内容 ${cw}×${ch} · 图片 ${meta.imageWidth ?? '?'}×${meta.imageHeight ?? '?'}</span>
  <label><input type="checkbox" id="showAll" checked> 显示全部</label>
  <label><input type="checkbox" id="onlyActed"> 仅显示本阶段操作过的控件</label>
  <span class="dim" id="actedStat"></span>
  <span class="legend" id="legend"></span>
</div>
<div class="wrap"><div class="stage" id="stage"></div></div>
<div class="side" id="side"></div>

<script>
  const KIND_COLORS = ${JSON.stringify(KIND_COLORS)};
  const KIND_COLOR = (k) => KIND_COLORS[k] || '#607d8b';
  const DATA = ${JSON.stringify({ elements, cw, ch, imageWidth: meta.imageWidth, imageHeight: meta.imageHeight, b64, imageUrl, steps })};
  const stage = document.getElementById('stage');
  const side = document.getElementById('side');
  const showAll = document.getElementById('showAll');
  const onlyActed = document.getElementById('onlyActed');

  // 本阶段操作过的控件：三维匹配（字段标签→label、操作 target_kind→kind、regionId→regionId）。
  // 任一维度为空则跳过该维（如实呈现，不做模糊/包含）。
  const stepKeys = (DATA.steps || []).filter((s) => s.label);
  function stepMatched(e) {
    return stepKeys.some((k) =>
      String(e.label || '') === k.label
      && (!k.kind || String(e.kind || '') === k.kind)
      && (!k.regionId || String(e.regionId || '') === k.regionId)
    );
  }
  const actedIndex = new Set();
  DATA.elements.forEach((e, i) => { if (stepMatched(e)) actedIndex.add(i); });
  document.getElementById('actedStat').textContent =
    '本阶段操作 ' + stepKeys.length + ' 步' +
    (stepKeys.length ? '（' + stepKeys.map((s) => s.label).join('、') + '）' : '') +
    ' · 匹配到 ' + actedIndex.size + ' 个控件';

  const W = ${Number(argValue('--width')) || 1400};
  const H = Math.round(W * DATA.ch / DATA.cw);
  stage.style.width = W + 'px';
  stage.style.height = H + 'px';

  const img = document.createElement('img');
  img.src = DATA.b64 ? 'data:image/png;base64,' + DATA.b64 : (DATA.imageUrl || '');
  img.alt = 'phase long screenshot';
  stage.appendChild(img);

  const scale = W / DATA.cw;
  const kinds = [...new Set(DATA.elements.map(e => e.kind))].sort();
  document.getElementById('legend').innerHTML = kinds
    .map(k => '<span><i style="background:' + KIND_COLOR[k] + '"></i>' + (k || '?') + '</span>').join('');

  const boxes = DATA.elements.map((e, i) => {
    const div = document.createElement('div');
    div.className = 'box';
    div.dataset.index = i;
    div.style.left = (e.rect.x1 * scale) + 'px';
    div.style.top = (e.rect.y1 * scale) + 'px';
    div.style.width = Math.max(2, (e.rect.x2 - e.rect.x1) * scale) + 'px';
    div.style.height = Math.max(2, (e.rect.y2 - e.rect.y1) * scale) + 'px';
    div.style.borderColor = KIND_COLOR(e.kind);
    div.style.background = KIND_COLOR(e.kind) + '33';
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = (e.label || '(无文本)') + ' · ' + (e.kind || '?');
    div.appendChild(tag);
    div.addEventListener('click', () => showDetail(e));
    div.addEventListener('mouseenter', () => { div.style.opacity = '1'; });
    stage.appendChild(div);
    return div;
  });

  function applyFilter() {
    boxes.forEach((div, i) => {
      const e = DATA.elements[i];
      const acted = actedIndex.has(i);
      div.classList.toggle('acted', acted);
      const hidden = !showAll.checked || (onlyActed.checked && !acted);
      div.style.display = hidden ? 'none' : '';
    });
  }
  showAll.addEventListener('change', applyFilter);
  onlyActed.addEventListener('change', applyFilter);
  applyFilter();


  function showDetail(e) {
    const html = '<h3>' + esc(e.label || '(无文本)') + '</h3><dl>'
      + '<dt>kind</dt><dd>' + esc(e.kind || '?') + '</dd>'
      + '<dt>index</dt><dd>' + e.index + '</dd>'
      + '<dt>rect（内容坐标）</dt><dd>(' + e.rect.x1 + ', ' + e.rect.y1 + ') → (' + e.rect.x2 + ', ' + e.rect.y2 + ')</dd>'
      + '<dt>regionId</dt><dd>' + esc(e.regionId || '') + '</dd>'
      + '<dt>parentRegionId</dt><dd>' + esc(e.parentRegionId || '') + '</dd>'
      + '<dt>layers</dt><dd>' + esc((e.layers || []).map(l => (l.role || '') + ':' + (l.label || '')).join(' → ') || '(空)') + '</dd>'
      + '<dt>outsideRoot</dt><dd>' + e.outsideRoot + '</dd>'
      + '</dl>';
    side.innerHTML = html;
    side.classList.add('open');
  }
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') side.classList.remove('open'); });
  function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
</script>
</body>
</html>`;
}

async function main() {
  const id = argValue('--id');
  const trajId = argValue('--trajectory');
  const phaseId = argValue('--phase');
  const v3File = argValue('--v3');

  if (v3File) return runV3Mode(v3File);

  if (!id && !trajId) {
    console.error('用法：--id <screenshotId> | --trajectory <id> [--phase <phaseId>] | --v3 <payload.json>（兼容 V3.0 groups / V3.1 flat）');
    process.exit(1);
  }

  const db = getDB();
  let row = null;
  if (id) {
    row = await db('screenshot').where({ id: Number(id) }).first();
  } else {
    let q = db('screenshot').where({ trajectory_id: Number(trajId), kind: 'phase_highlight' });
    if (phaseId) q = q.where({ trajectory_phase_id: Number(phaseId) });
    row = await q.orderBy('id', 'desc').first();
  }
  if (!row) {
    console.error('未找到阶段截图（screenshot 行）');
    await db.destroy();
    process.exit(1);
  }

  const meta = typeof row.metadata_json === 'string' ? JSON.parse(row.metadata_json) : row.metadata_json;
  if (!meta || !Array.isArray(meta.elements) || !meta.elements.length) {
    console.error(`screenshot #${row.id} 无 elements（metadata 为空或非 phase 截图）`);
    await db.destroy();
    process.exit(1);
  }

  const b64 = await loadScreenshotB64(db, row.image_url || `/api/v2/screenshots/${row.id}/image`);

  // 本阶段操作过的控件（调研探索用）：读取同 phase 的步骤 element。
  // 三维匹配键：label = formLabel（字段标签）|| text（按钮/菜单文本）；
  //            kind = target_kind（操作目标类型，对应 elements.kind）；
  //            regionId = region_id（步骤无 region 时为空，该维度跳过）。
  let steps = [];
  if (row.trajectory_phase_id) {
    const stepRows = await db('trajectory_step')
      .select('action_type', 'element_json')
      .where({ trajectory_phase_id: row.trajectory_phase_id });
    for (const s of stepRows) {
      let el = null;
      try { el = typeof s.element_json === 'string' ? JSON.parse(s.element_json) : s.element_json; } catch {}
      if (!el) continue;
      const label = String(el.formLabel ?? el.label ?? el.matchedLabel ?? el.text ?? '').trim();
      if (!label) continue;
      steps.push({
        label,
        kind: String(el.target_kind ?? ''),
        regionId: String(el.region_id ?? ''),
        actionType: String(s.action_type || ''),
      });
    }
  }

  const html = buildHtml({ b64, meta, screenshotId: row.id, steps, imageUrl: row.image_url || `/api/v2/screenshots/${row.id}/image` });
  const out = join(ROOT, 'tmp', `lightup-${row.id}.html`);
  writeFileSync(out, html, 'utf8');
  console.log(`已生成: ${out}`);
  console.log(`screenshot #${row.id} | kind=${row.kind} | elements=${meta.elements.length} | image=${meta.imageWidth}x${meta.imageHeight} | content=${meta.contentWidth}x${meta.contentHeight}`);
  console.log(`本阶段步骤: ${steps.length}（${steps.map((s) => s.label).join('、') || '无'}）| 匹配到阶段图控件: ${meta.elements.filter((e) => steps.some((s) => String(e.label || '') === s.label && (!s.kind || String(e.kind || '') === s.kind) && (!s.regionId || String(e.regionId || '') === s.regionId))).length}`);
  await db.destroy();
}

/**
 * 尝试 fetch 一个 URL 并转 base64；失败或超时返回空字符串。
 */
async function fetchB64(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString('base64');
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 根据截图 URL 加载 base64：优先从本地 DB（/screenshots/:id/image），
 * 否则尝试直接 fetch MinIO/公网 URL；直连失败时再尝试把 host 换成 127.0.0.1
 * （便于本机已开 SSH 反向隧道转发 MinIO 的场景）。
 */
async function loadScreenshotB64(db, url) {
  const u = String(url || '');
  if (!u) return '';
  const idMatch = u.match(/\/screenshots\/(\d+)\/image/);
  if (idMatch) {
    const row = await db('screenshot').where({ id: Number(idMatch[1]) }).first();
    if (row?.image_data) return row.image_data.toString('base64');
    return '';
  }
  const direct = await fetchB64(u);
  if (direct) return direct;
  try {
    const parsed = new URL(u);
    parsed.hostname = '127.0.0.1';
    const fallback = parsed.toString();
    if (fallback !== u) return fetchB64(fallback);
  } catch {
    // 非标准 URL 不做 fallback
  }
  return '';
}

/** V3.0 模式：读旧 result.groups，按页面组渲染。 */
async function runV3GroupsMode(entry, result, file) {
  const db = getDB();
  try {
    const pages = [];
    for (const g of result.groups) {
      if (g.type !== 'page') continue;
      const shotUrl = String(g.screenshots?.[0]?.url || '');
      const b64 = await loadScreenshotB64(db, shotUrl);
      const dialogs = result.groups.filter((c) => c.type === 'dialog' && c.pid === g.id);
      const dlgObjs = dialogs.map((d) => ({
        id: d.id,
        name: d.name || d.id,
        screenshots: d.screenshots || [],
        b64: '',
        rect: d.rect || {},
        controls: result.groups.filter((c) => c.type === 'ele' && c.pid === d.id),
      }));
      const dlgIds = new Set(dlgObjs.map((d) => d.id));
      const controls = result.groups.filter(
        (c) => c.type === 'ele' && (c.pid === g.id || dlgIds.has(c.pid)),
      );
      pages.push({ id: g.id, name: g.name, screenshots: g.screenshots || [], b64, dialogs: dlgObjs, controls });
    }
    const html = buildV3Html({ result, pages });
    const out = join(ROOT, 'tmp', `lightup-v3-${result.id || 'payload'}.html`);
    writeFileSync(out, html, 'utf8');
    const eles = result.groups.filter((g) => g.type === 'ele');
    const withRect = eles.filter((c) => c.rect).length;
    const noB64 = pages.filter((p) => !p.b64).length;
    console.log(`已生成: ${out}`);
    console.log(`交易 ${result.name} | 页面组 ${pages.length} | 控件 ${eles.length}（带 rect ${withRect}）| 无截图页面组 ${noB64}`);
  } finally {
    await db.destroy();
  }
}

/** V3.1 模式：读新版 flat transcationProperties，截图条目和控件条目同构。 */
async function runV3FlatMode(entry, properties, file) {
  const db = getDB();
  try {
    const shots = properties.filter((p) => p.type === 'page' || p.type === 'dialog');
    const eles = properties.filter((p) => p.type === 'ele');
    const pages = [];
    const handledDialogIds = new Set();

    // 页面为主：弹窗通过 propertiesPID 挂在页面下
    for (const p of shots.filter((s) => s.type === 'page')) {
      const url = Array.isArray(p.screenshot) ? p.screenshot[0] : '';
      const b64 = await loadScreenshotB64(db, url);
      const dialogs = shots.filter(
        (d) => d.type === 'dialog' && String(d.propertiesPID ?? '') === String(p.propertiesID ?? ''),
      );
      const dlgObjs = [];
      const dlgIds = new Set();
      for (const d of dialogs) {
        handledDialogIds.add(String(d.propertiesID ?? ''));
        const dUrl = Array.isArray(d.screenshot) ? d.screenshot[0] : '';
        const dB64 = await loadScreenshotB64(db, dUrl);
        dlgObjs.push({
          id: d.propertiesID || d.propertiesName || 'dlg',
          name: d.propertiesName || '弹窗',
          screenshots: Array.isArray(d.screenshot) ? d.screenshot : [],
          b64: dB64,
          rect: (d.rect && Object.keys(d.rect).length ? d.rect : {}),
          controls: eles.filter((e) => String(e.propertiesPID ?? '') === String(d.propertiesID ?? '')),
        });
        dlgIds.add(String(d.propertiesID ?? ''));
      }
      const controls = eles.filter(
        (e) => String(e.propertiesPID ?? '') === String(p.propertiesID ?? '') || dlgIds.has(String(e.propertiesPID ?? '')),
      );
      pages.push({
        id: p.propertiesID || p.propertiesName || 'page',
        name: p.propertiesName || '页面',
        screenshots: Array.isArray(p.screenshot) ? p.screenshot : [],
        b64,
        dialogs: dlgObjs,
        controls,
      });
    }

    // 旧数据/无父弹窗：仍然独立成一个 stage，避免丢控件
    for (const d of shots.filter((s) => s.type === 'dialog' && !handledDialogIds.has(String(s.propertiesID ?? '')))) {
      const dUrl = Array.isArray(d.screenshot) ? d.screenshot[0] : '';
      const dB64 = await loadScreenshotB64(db, dUrl);
      const controls = eles.filter((e) => String(e.propertiesPID ?? '') === String(d.propertiesID ?? ''));
      pages.push({
        id: d.propertiesID || d.propertiesName || 'dlg',
        name: d.propertiesName || '弹窗',
        screenshots: Array.isArray(d.screenshot) ? d.screenshot : [],
        b64: dB64,
        dialogs: [],
        controls,
      });
    }

    const result = { name: entry?.transcationName || file };
    const html = buildV3Html({ result, pages });
    const out = join(ROOT, 'tmp', `lightup-v3-${String(entry?.transcId || 'payload').replace(/[^A-Za-z0-9_-]/g, '_')}.html`);
    writeFileSync(out, html, 'utf8');
    const withRect = eles.filter((c) => c.rect && Object.keys(c.rect).length > 0).length;
    const noB64 = pages.filter((p) => !p.b64).length;
    console.log(`已生成: ${out}`);
    console.log(`交易 ${result.name} | 截图条目 ${shots.length} | 控件 ${eles.length}（带 rect ${withRect}）| 无截图 ${noB64}`);
  } finally {
    await db.destroy();
  }
}

/**
 * V3 模式：读 V3 批量推送 payload JSON。
 * 兼容 V3.0 result.groups 和 V3.1 flat transcationProperties。
 * 用法：node scripts/tools/lightup-phase-screenshot.mjs --v3 tmp/v3-payload-38.json
 */
async function runV3Mode(file) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error('读取/解析 V3 payload 失败:', err.message);
    process.exit(1);
  }
  const entry = payload?.payload?.transcationEventTypeList?.[0];
  const result = entry?.result;
  if (result && Array.isArray(result.groups) && result.groups.length) {
    return runV3GroupsMode(entry, result, file);
  }
  const properties = entry?.transcationProperties;
  if (Array.isArray(properties) && properties.some((p) => p && ['page', 'dialog', 'ele'].includes(p.type))) {
    return runV3FlatMode(entry, properties, file);
  }
  console.error('V3 payload 既无 result.groups，也无新版 transcationProperties type 条目（page/dialog/ele）');
  process.exit(1);
}

/** V3 渲染：每页面组一个 stage（长图 + 控件框），checkbox 勾选点亮任意子集。 */
function buildV3Html({ result, pages }) {
  const ctrlCount = pages.reduce((n, p) => n + p.controls.length, 0);
  const rectCount = pages.reduce((n, p) => n + p.controls.filter((c) => c.rect).length, 0);
  const pagesJson = JSON.stringify(pages);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>V3 控件点亮 · ${esc(result.name || '')}</title>
<style>
  body { margin: 0; background: #f5f5f5; font-family: system-ui, sans-serif; }
  .bar { position: sticky; top: 0; z-index: 20; background: #fff; padding: 8px 14px;
         border-bottom: 1px solid #ddd; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .bar b { font-size: 14px; }
  .bar .dim { color: #888; font-size: 12px; }
  .wrap { display: flex; gap: 12px; padding: 12px; align-items: flex-start; }
  .panel { width: 320px; background: #fff; border: 1px solid #e8e8e8; border-radius: 4px;
           max-height: calc(100vh - 80px); overflow: auto; flex-shrink: 0; }
  .panel h4 { margin: 0; padding: 8px 10px; font-size: 13px; border-bottom: 1px solid #f0f0f0;
              position: sticky; top: 0; background: #fff; }
  .page-title { padding: 6px 10px; font-size: 12px; font-weight: 600; color: #1890ff;
                background: #f0f7ff; border-top: 1px solid #f0f0f0; }
  .ctrl { padding: 4px 10px; font-size: 12px; display: flex; gap: 6px; align-items: center; cursor: pointer; }
  .ctrl:hover { background: #e6f7ff; }
  .ctrl .tag { background: #f5f5f5; border: 1px solid #e8e8e8; border-radius: 2px; padding: 0 4px; color: #595959; flex-shrink: 0; }
  .ctrl.dlg { padding-left: 26px; }
  .ctrl.dlg .tag { background: #fff7e6; border-color: #ffd591; color: #d46b08; }
  .ctrl .no-rect { color: #bfbfbf; font-size: 11px; }
  .pages { flex: 1; display: flex; flex-direction: column; gap: 16px; }
  .pg { background: #fff; border: 1px solid #e8e8e8; border-radius: 4px; overflow: hidden; }
  .pg .pg-head { padding: 8px 12px; font-size: 13px; font-weight: 600; border-bottom: 1px solid #f0f0f0;
                 display: flex; gap: 10px; align-items: center; }
  .pg .pg-head .dim { font-weight: 400; color: #888; font-size: 12px; }
  .pg .stage { position: relative; background: #fff; }
  .pg .stage img { display: block; width: 100%; height: auto; }
  .dlg-overlay { position: absolute; display: none; border: 2px dashed #fa8c16;
                 background: rgba(250,140,22,.06); overflow: hidden; z-index: 3; box-sizing: border-box; }
  .dlg-overlay.on { display: block; }
  .dlg-overlay img { display: block; width: 100%; height: 100%; }
  .dlg-overlay .box { position: absolute; }
  .box { position: absolute; border: 2px solid #4caf50; background: rgba(76,175,80,.16);
         display: none; box-sizing: border-box; cursor: pointer; }
  .box.on { display: block; }
  .box.dlg { border-color: #fa8c16; background: rgba(250,140,22,.16); }
  .box .no { position: absolute; top: -15px; left: -2px; background: #4caf50; color: #fff;
             font-size: 10px; padding: 0 4px; border-radius: 2px; line-height: 14px; }
  .box.dlg .no { background: #fa8c16; }
  .box:hover { box-shadow: 0 0 0 2px #ffeb3b; z-index: 5; }
</style>
</head>
<body>
<div class="bar">
  <b>V3 控件点亮</b>
  <span class="dim">${esc(result.name || '')} · 页面组 ${pages.length} · 控件 ${ctrlCount}（带 rect ${rectCount}）· 勾选任意子集点亮</span>
  <button id="all">全部点亮</button><button id="none">全部熄灭</button>
</div>
<div class="wrap">
  <div class="panel"><h4>控件清单</h4><div id="list"></div></div>
  <div class="pages" id="pages"></div>
</div>
<script>
  const PAGES = ${pagesJson};
  const list = document.getElementById('list');
  const pagesEl = document.getElementById('pages');
  const boxes = {};

  for (const pg of PAGES) {
    const sec = document.createElement('div');
    sec.className = 'pg';
    const head = document.createElement('div');
    head.className = 'pg-head';
    head.innerHTML = '<span>' + esc(pg.name || pg.id) + '</span><span class="dim">' + (pg.controls || []).length + ' 控件</span>';
    const stage = document.createElement('div');
    stage.className = 'stage';
    const img = document.createElement('img');
    img.src = pg.b64 ? 'data:image/png;base64,' + pg.b64 : (pg.screenshots && pg.screenshots[0] ? pg.screenshots[0] : '');
    stage.appendChild(img);
    sec.appendChild(head);
    sec.appendChild(stage);
    pagesEl.appendChild(sec);

    const pt = document.createElement('div');
    pt.className = 'page-title';
    pt.textContent = '▣ ' + (pg.name || pg.id);
    list.appendChild(pt);

    const dialogs = pg.dialogs || [];
    const overlayDlgIds = new Set();
    const dlgOverlayEls = {};
    for (const dlg of dialogs) {
      if (!dlg.b64 || !dlg.rect || !(dlg.rect.x2 > dlg.rect.x1) || !(dlg.rect.y2 > dlg.rect.y1)) continue;
      overlayDlgIds.add(String(dlg.id));
      const overlay = document.createElement('div');
      overlay.className = 'dlg-overlay';
      const dlgImg = document.createElement('img');
      dlgImg.src = dlg.b64 ? 'data:image/png;base64,' + dlg.b64 : (dlg.screenshots && dlg.screenshots[0] ? dlg.screenshots[0] : '');
      overlay.appendChild(dlgImg);
      stage.appendChild(overlay);
      dlgOverlayEls[String(dlg.id)] = overlay;

      const dt = document.createElement('label');
      dt.className = 'ctrl dlg dlg-toggle';
      const dcb = document.createElement('input');
      dcb.type = 'checkbox';
      dcb.addEventListener('change', () => {
        overlay.classList.toggle('on', dcb.checked);
        const cs = dlg.controls || [];
        for (const c of cs) {
          const key = c.id || c.propertiesID;
          const b = boxes[key];
          if (b) b.classList.toggle('on', dcb.checked && b.dataset.checked === 'true');
        }
      });
      dt.appendChild(dcb);
      dt.appendChild(Object.assign(document.createElement('span'), { className: 'tag', textContent: '弹窗截图' }));
      dt.appendChild(Object.assign(document.createElement('span'), { textContent: dlg.name || dlg.id }));
      list.appendChild(dt);
    }

    const pageControls = pg.controls || [];
    for (const c of pageControls) {
      const key = c.id || c.propertiesID;
      const inOverlay = overlayDlgIds.has(String(c.pid || c.propertiesPID));
      const div = document.createElement('label');
      div.className = 'ctrl' + (inOverlay ? ' dlg' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      const setBox = (on) => {
        const b = boxes[key];
        if (b) {
          b.classList.toggle('on', on);
          b.dataset.checked = on ? 'true' : 'false';
        }
      };
      cb.addEventListener('change', () => setBox(cb.checked));
      div.appendChild(cb);
      div.appendChild(Object.assign(document.createElement('span'), { className: 'tag', textContent: c.kind || c.eventTypeValue || c.eventTypeName || '?' }));
      div.appendChild(Object.assign(document.createElement('span'), { textContent: c.propertiesName || c.realLabel || c.label || c.id || c.propertiesID }));
      if (!c.rect) div.appendChild(Object.assign(document.createElement('span'), { className: 'no-rect', textContent: '(无坐标)' }));
      list.appendChild(div);
    }

    img.addEventListener('load', () => {
      const natW = img.naturalWidth || 1;
      const dispW = img.getBoundingClientRect().width || natW;
      const scale = dispW / natW;

      for (const dlg of dialogs) {
        if (!overlayDlgIds.has(String(dlg.id))) continue;
        const overlay = dlgOverlayEls[String(dlg.id)];
        const r = dlg.rect;
        overlay.style.left = (r.x1 * scale) + 'px';
        overlay.style.top = (r.y1 * scale) + 'px';
        overlay.style.width = Math.max(2, (r.x2 - r.x1) * scale) + 'px';
        overlay.style.height = Math.max(2, (r.y2 - r.y1) * scale) + 'px';
        const dlgImg = overlay.querySelector('img');
        const drawDlg = () => {
          const dNatW = dlgImg.naturalWidth || 1;
          const dNatH = dlgImg.naturalHeight || 1;
          const dCtrls = dlg.controls || [];
          for (const dc of dCtrls) {
            const dkey = dc.id || dc.propertiesID;
            if (!dc.rect || boxes[dkey]) continue;
            const b = document.createElement('div');
            b.className = 'box dlg';
            b.style.left = ((dc.rect.x1 / dNatW) * overlay.clientWidth) + 'px';
            b.style.top = ((dc.rect.y1 / dNatH) * overlay.clientHeight) + 'px';
            b.style.width = Math.max(2, ((dc.rect.x2 - dc.rect.x1) / dNatW) * overlay.clientWidth) + 'px';
            b.style.height = Math.max(2, ((dc.rect.y2 - dc.rect.y1) / dNatH) * overlay.clientHeight) + 'px';
            b.innerHTML = '<span class="no">' + String(dc.id || dc.propertiesID || '').replace('step-', '') + '</span>';
            b.title = (dc.propertiesName || dc.realLabel || dc.label || dc.id || dc.propertiesID) + ' · ' + (dc.kind || dc.eventTypeValue || dc.eventTypeName || '') + ' · rect(' + dc.rect.x1 + ',' + dc.rect.y1 + ')-(' + dc.rect.x2 + ',' + dc.rect.y2 + ')';
            overlay.appendChild(b);
            boxes[dkey] = b;
          }
        };
        if (dlgImg.complete && dlgImg.naturalWidth > 0) drawDlg();
        else dlgImg.addEventListener('load', drawDlg);
      }

      for (const c of pageControls) {
        const key = c.id || c.propertiesID;
        if (!c.rect || boxes[key]) continue;
        if (overlayDlgIds.has(String(c.pid || c.propertiesPID))) continue;
        const b = document.createElement('div');
        b.className = 'box';
        b.style.left = (c.rect.x1 * scale) + 'px';
        b.style.top = (c.rect.y1 * scale) + 'px';
        b.style.width = Math.max(2, (c.rect.x2 - c.rect.x1) * scale) + 'px';
        b.style.height = Math.max(2, (c.rect.y2 - c.rect.y1) * scale) + 'px';
        b.innerHTML = '<span class="no">' + String(c.id || c.propertiesID || '').replace('step-', '') + '</span>';
        b.title = (c.propertiesName || c.realLabel || c.label || c.id || c.propertiesID) + ' · ' + (c.kind || c.eventTypeValue || c.eventTypeName || '') + ' · rect(' + c.rect.x1 + ',' + c.rect.y1 + ')-(' + c.rect.x2 + ',' + c.rect.y2 + ')';
        stage.appendChild(b);
        boxes[key] = b;
      }
    });
  }

  document.getElementById('all').onclick = () => {
    Object.values(boxes).forEach(b => b.classList.add('on'));
    document.querySelectorAll('.ctrl input').forEach(c => c.checked = true);
    document.querySelectorAll('.dlg-overlay').forEach(o => o.classList.add('on'));
  };
  document.getElementById('none').onclick = () => {
    Object.values(boxes).forEach(b => b.classList.remove('on'));
    document.querySelectorAll('.ctrl input').forEach(c => c.checked = false);
    document.querySelectorAll('.dlg-overlay').forEach(o => o.classList.remove('on'));
  };
  function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
</script>
</body>
</html>`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
