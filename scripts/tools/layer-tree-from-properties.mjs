#!/usr/bin/env node
/**
 * transcationProperties[] 元素分层工具（独立于阶段图高亮）。
 *
 * 输入：批量推送导出的 JSON（含 transcationProperties[]，见
 *   docs/superpowers/samples/traj157-transaction-export.sample.json）。
 * 输出：tmp/layer-tree-<name>.html —— fc-tree 风格分层树
 *   （参考对方平台脚本编辑页：层级色标签 + 缩进 + 叶=操作步骤）。
 *
 * 分层依据：每步 transcationProperties[].regionId（"role:label|role:label" 多段，
 *   如 "tab:基本信息|titlebox:客户概况"）拆层级链；无 regionId 的操作归「未分区」。
 *
 * 用法：
 *   node scripts/tools/layer-tree-from-properties.mjs --file <export.json>
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ROLE_LEVEL = {
  page: ['page', '页面'], main: ['page', '主区'], shell_header: ['page', '页头'], other: ['page', '其他'],
  tab: ['tab', 'tab页签'], wizard_step: ['wizard', '步骤向导'],
  dialog: ['popup', '弹窗'], drawer: ['popup', '抽屉'], overlay: ['popup', '弹层'],
  titlebox: ['section', '标题栏'], collapse: ['section', '折叠面板'], block: ['section', '区块'],
  card: ['section', '卡片'], section: ['section', '分区'], table: ['section', '表格'],
};
const roleInfo = (r) => ROLE_LEVEL[r] || ['section', '分区'];
const ACTION_TAG = {
  click: '点击', input: '输入', fill_form_field: '输入', select_option: '选择', select_date: '选日期',
  select_radio: '选单选', click_save: '保存', click_adjacent_button: '点相邻按钮',
};
const actionTag = (v) => ACTION_TAG[v] || v || '操作';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 从 transcationProperties[] 按 regionId 拆层级建树；叶 = 操作步骤。 */
function buildTreeFromProperties(properties) {
  const root = { role: 'page', label: '交易操作', children: [], items: [] };
  const map = new Map();
  map.set('', root);
  (properties || []).forEach((p, idx) => {
    const regionId = String(p.regionId || '').trim();
    const segs = regionId
      .split('|').map((s) => s.trim()).filter(Boolean)
      .map((seg) => {
        const i = seg.indexOf(':');
        return i > 0
          ? { role: seg.slice(0, i).trim(), label: seg.slice(i + 1).trim() }
          : { role: 'section', label: seg };
      });
    let parent = root;
    let key = '';
    for (const s of segs) {
      key += '|' + s.role + ':' + s.label;
      if (!map.has(key)) {
        const n = { role: s.role, label: s.label, children: [], items: [] };
        map.set(key, n);
        parent.children.push(n);
      }
      parent = map.get(key);
    }
    parent.items.push({
      no: idx + 1,
      name: String(p.propertiesName || '').trim() || '(无名称)',
      action: actionTag(String(p.eventTypeValue || p.eventTypeName || '').trim()),
      actionValue: String(p.eventTypeValue || '').trim(),
      regionId,
    });
  });
  return root;
}

/** 递归渲染树为 HTML 字符串（fc-tree 风格）。 */
function treeToHtml(node, depth) {
  const pad = 8 + depth * 18;
  const [cls, label] = roleInfo(node.role);
  let html = `<div class="tree-node" style="padding-left:${pad}px">`
    + `<span class="tree-level-type ${cls}">${esc(label)}</span>`
    + `<span class="tree-colon">：</span>`
    + `<span class="tree-name">${esc(node.label || '(未命名)')}</span></div>`;
  for (const it of node.items) {
    html += `<div class="tree-node" style="padding-left:${pad + 18}px" `
      + `title="${esc('regionId: ' + (it.regionId || '(无)') + ' | eventType: ' + (it.actionValue || it.action))}">`
      + `<span class="tree-step-no">${it.no}</span>`
      + `<span class="tree-object-tag">${esc(it.action)}</span>`
      + `<span class="tree-name">${esc(it.name)}</span></div>`;
  }
  for (const c of node.children) html += treeToHtml(c, depth + 1);
  return html;
}

function buildHtml({ properties, title }) {
  const unzoned = (properties || []).filter((p) => !String(p.regionId || '').trim()).length;
  const treeHtml = treeToHtml(buildTreeFromProperties(properties), 0);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>transcationProperties 分层 · ${esc(title)}</title>
<style>
  body { margin: 0; background: #f5f5f5; font-family: system-ui, sans-serif; }
  .bar { background: #fff; padding: 8px 16px; border-bottom: 1px solid #e8e8e8;
         display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .bar b { font-size: 14px; color: #262626; }
  .bar .dim { color: #8c8c8c; font-size: 12px; }
  .wrap { padding: 12px 16px; }
  .tree-panel { background: #fff; border: 1px solid #e8e8e8; border-radius: 4px; max-width: 760px; }
  .tree-title { padding: 10px 12px; font-size: 13px; font-weight: 600; color: #262626;
                border-bottom: 1px solid #f0f0f0; }
  .tree-list { padding: 6px 0; max-height: calc(100vh - 120px); overflow: auto; }
  .tree-node { display: flex; align-items: center; gap: 4px; font-size: 13px; line-height: 22px;
               cursor: default; white-space: nowrap; padding: 2px 8px; }
  .tree-node:hover { background: #e6f7ff; }
  .tree-level-type { font-size: 11px; padding: 0 6px; border-radius: 2px; color: #fff;
                     font-weight: 500; line-height: 18px; flex-shrink: 0; }
  .tree-level-type.page { background: #1890ff; }
  .tree-level-type.tab { background: #52c41a; }
  .tree-level-type.popup { background: #fa8c16; }
  .tree-level-type.section { background: #722ed1; }
  .tree-level-type.wizard { background: #13c2c2; }
  .tree-colon { color: #8c8c8c; flex-shrink: 0; }
  .tree-name { color: #262626; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .tree-step-no { color: #bfbfbf; font-size: 11px; width: 22px; flex-shrink: 0; }
  .tree-object-tag { font-size: 11px; color: #595959; background: #f5f5f5;
                     border: 1px solid #e8e8e8; border-radius: 2px; padding: 0 5px;
                     line-height: 16px; flex-shrink: 0; }
</style>
</head>
<body>
<div class="bar">
  <b>transcationProperties 元素分层</b>
  <span class="dim">${esc(title)} · 操作 ${(properties || []).length} 步 · 未分区 ${unzoned}</span>
</div>
<div class="wrap">
  <div class="tree-panel">
    <div class="tree-title">操作步骤（按 regionId 分层）</div>
    <div class="tree-list" id="treeList">${treeHtml}</div>
  </div>
</div>
</body>
</html>`;
}

function main() {
  const file = argValue('--file');
  if (!file) {
    console.error('用法：--file <export.json>（含 transcationProperties[] 的推送导出）');
    process.exit(1);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error('读取/解析失败:', err.message);
    process.exit(1);
  }
  // 兼容 { data: { payload: { transcationEventTypeList } } } 或直接 { transcationEventTypeList }
  const data = raw?.data ?? raw;
  const list = data?.payload?.transcationEventTypeList ?? data?.transcationEventTypeList ?? [];
  const entry = list[0] || {};
  const properties = entry.transcationProperties || [];
  const title = String(entry.transcationName || '').trim() || file;

  const html = buildHtml({ properties, title });
  const base = String(file).split(/[\\/]/).pop().replace(/\.[^.]+$/, '') || 'props';
  const out = join(ROOT, 'tmp', `layer-tree-${base}.html`);
  writeFileSync(out, html, 'utf8');
  console.log(`已生成: ${out}`);
  console.log(`交易: ${title} | 操作 ${properties.length} 步 | 未分区 ${properties.filter((p) => !String(p.regionId || '').trim()).length}`);
}

main();
