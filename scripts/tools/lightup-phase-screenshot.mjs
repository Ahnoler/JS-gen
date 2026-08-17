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
 *
 * 输出：tmp/lightup-<screenshotId>.html（浏览器打开即可）
 */
import { writeFileSync } from 'fs';
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

function buildHtml({ b64, meta, screenshotId }) {
  const elements = (Array.isArray(meta.elements) ? meta.elements : [])
    .filter((e) => e && e.rect
      && Number.isFinite(e.rect.x1) && Number.isFinite(e.rect.y1)
      && Number.isFinite(e.rect.x2) && Number.isFinite(e.rect.y2)
      && e.rect.x2 > e.rect.x1 && e.rect.y2 > e.rect.y1);
  const cw = Number(meta.contentWidth) || 1;
  const ch = Number(meta.contentHeight) || 1;

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
  <label><input type="checkbox" id="onlyLabel" checked> 仅显示有文本控件</label>
  <label><input type="checkbox" id="showAll" checked> 显示全部</label>
  <span class="legend" id="legend"></span>
</div>
<div class="wrap"><div class="stage" id="stage"></div></div>
<div class="side" id="side"></div>

<script>
  const KIND_COLORS = ${JSON.stringify(KIND_COLORS)};
  const KIND_COLOR = (k) => KIND_COLORS[k] || '#607d8b';
  const DATA = ${JSON.stringify({ elements, cw, ch, imageWidth: meta.imageWidth, imageHeight: meta.imageHeight, b64 })};
  const stage = document.getElementById('stage');
  const side = document.getElementById('side');
  const onlyLabel = document.getElementById('onlyLabel');
  const showAll = document.getElementById('showAll');

  const W = ${Number(argValue('--width')) || 1400};
  const H = Math.round(W * DATA.ch / DATA.cw);
  stage.style.width = W + 'px';
  stage.style.height = H + 'px';

  const img = document.createElement('img');
  img.src = 'data:image/png;base64,' + DATA.b64;
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
      const hidden = !showAll.checked || (onlyLabel.checked && !e.label);
      div.style.display = hidden ? 'none' : '';
    });
  }
  onlyLabel.addEventListener('change', applyFilter);
  showAll.addEventListener('change', applyFilter);
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

  if (!id && !trajId) {
    console.error('用法：--id <screenshotId> 或 --trajectory <id> [--phase <phaseId>]');
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

  const b64 = row.image_data.toString('base64');
  const html = buildHtml({ b64, meta, screenshotId: row.id });
  const out = join(ROOT, 'tmp', `lightup-${row.id}.html`);
  writeFileSync(out, html, 'utf8');
  console.log(`已生成: ${out}`);
  console.log(`screenshot #${row.id} | kind=${row.kind} | elements=${meta.elements.length} | image=${meta.imageWidth}x${meta.imageHeight} | content=${meta.contentWidth}x${meta.contentHeight}`);
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
