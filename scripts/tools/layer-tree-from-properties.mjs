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
 * 兼容：
 *   - V3.0：--v3 <payload.json> 读 result.groups
 *   - V3.1：--file/--v3 读新版 flat transcationProperties（type=page/popup/section/tab/wizard/card/object）
 *
 * 用法：
 *   node scripts/tools/layer-tree-from-properties.mjs --file <export.json>
 *   node scripts/tools/layer-tree-from-properties.mjs --v3 <payload.json>
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getDB } from '../../config/database.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 仅直接执行时才跑 CLI（import 用于 characterization 时不触发）。 */
function isDirectRun() {
  const entry = process.argv[1] ? resolve(process.argv[1]) : '';
  return !!entry && fileURLToPath(import.meta.url).toLowerCase() === entry.toLowerCase();
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** V3 payload 契约 rect 为 JSON 字符串（空 ""）；旧导出文件仍是对象。归一成对象供建树/渲染。 */
function parseRectStrings(properties) {
  for (const p of Array.isArray(properties) ? properties : []) {
    if (p && typeof p.rect === 'string') {
      if (!p.rect.trim()) {
        p.rect = {};
        continue;
      }
      try {
        const r = JSON.parse(p.rect);
        p.rect = r && typeof r === 'object' ? r : {};
      } catch {
        p.rect = {};
      }
    }
  }
  return properties;
}

const ROLE_LEVEL = {
  page: ['page', '页面'], main: ['page', '主区'], shell_header: ['page', '页头'], other: ['page', '其他'],
  tab: ['tab', 'tab页签'], wizard_step: ['wizard', '步骤向导'],
  dialog: ['popup', '弹窗'], drawer: ['popup', '抽屉'], overlay: ['popup', '弹层'],
  titlebox: ['section', '标题栏'], collapse: ['section', '折叠面板'], block: ['section', '区块'],
  card: ['card', '卡片'], section: ['section', '分区'], table: ['section', '表格'],
};
const roleInfo = (r) => ROLE_LEVEL[r] || ['section', '分区'];
const ACTION_TAG = {
  click: '点击', input: '输入', fill_form_field: '输入', select_option: '选择', select_date: '选日期',
  select_radio: '选单选', click_save: '保存', click_adjacent_button: '点相邻按钮',
};
const actionTag = (v) => ACTION_TAG[v] || v || '操作';
const KIND_TAG = {
  form_input: '文本框', form_select: '下拉框', form_date: '日期框', form_radio: '单选框',
  form_checkbox: '复选框', form_tree_select: '树选择', button: '按钮', menu: '菜单', icon: '图标',
  table_row_button: '行内按钮', tree_node: '树节点', tab: '页签', submenu: '子菜单',
  breadcrumb: '面包屑', card: '卡片', collapse: '折叠', dialog: '弹窗', drawer: '抽屉',
  todo: '待办', wizard_step: '向导', form_label: '标签',
};
const kindTag = (k) => KIND_TAG[k] || k || '控件';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 从 transcationProperties[] 按 regionId 拆层级建树；叶 = 操作步骤。 */
export function buildTreeFromProperties(properties) {
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

/**
 * 从 V3.1 flat transcationProperties[] 构建分层树。
 * 新版 V3 把截图条目（type=page/popup）、中间节点（type=section/tab/wizard/card）和控件条目（type=object）
 * 合并到同一个数组，propertiesPID → propertiesID 链已表达完整层级：
 *   - 第一遍：page/popup/section/tab/wizard/card 都建为节点（中间节点 pid 指向 page/popup 或上层节点；
 *     popup 的 pid 指向 page）。
 *   - 第三遍：object 的 pid 指向最近中间节点（或直指 page/popup）。
 *     pid 命中中间节点时直接挂到该节点（PID 链已表达分区层级，不再 regionId 拆段）；
 *     pid 直指 page/popup、未命中或旧数据无中间节点时，
 *     保留 regionId 拆段建 tab/section/card 等中间层级作为 fallback（保持兼容）。
 */
// §8 中间节点 type 集合（截图条目 page/popup 之外的层级节点）
const V3_INTERMEDIATE_TYPES = new Set(['section', 'tab', 'wizard', 'card', 'collapse']);
// 中间节点在树中的 role 集合（type 直接作为 role，popup 例外映射为 dialog）
const V3_INTERMEDIATE_ROLES = new Set(['section', 'tab', 'wizard', 'card', 'collapse']);
// V3.1 截图条目 type 集合
const V3_SHOT_TYPES = new Set(['page', 'popup']);

export function buildTreeFromV3Flat(properties) {
  const root = { role: 'page', label: '交易页面', children: [], items: [] };
  const nodeMap = new Map();
  // 第一遍：page / popup / 中间节点（section/tab/wizard/card/collapse）都建为节点
  for (const p of properties || []) {
    if (p.type !== 'page' && p.type !== 'popup' && !V3_INTERMEDIATE_TYPES.has(p.type)) continue;
    const role = p.type === 'popup' ? 'dialog' : p.type;
    const fallbackLabel = p.type === 'popup' ? '弹窗'
      : p.type === 'section' ? '分区'
      : p.type === 'tab' ? 'tab页签'
      : p.type === 'wizard' ? '步骤向导'
      : p.type === 'card' ? '卡片'
      : p.type === 'collapse' ? '折叠面板'
      : '页面';
    const node = {
      role,
      label: String(p.propertiesName || '').trim() || fallbackLabel,
      id: String(p.propertiesID ?? ''),
      children: [],
      items: [],
    };
    nodeMap.set(node.id, node);
  }
  // 第二遍：按 propertiesPID 挂父子；无父（孤立/根级）保持 root 下
  for (const p of properties || []) {
    if (p.type === 'page') {
      const node = nodeMap.get(String(p.propertiesID ?? ''));
      if (node) root.children.push(node);
    } else if (p.type === 'popup' || V3_INTERMEDIATE_TYPES.has(p.type)) {
      const node = nodeMap.get(String(p.propertiesID ?? ''));
      const parent = nodeMap.get(String(p.propertiesPID ?? ''));
      if (node && parent) parent.children.push(node);
      else if (node) root.children.push(node);
    }
  }
  let eleNo = 0;
  for (const p of properties || []) {
    if (p.type !== 'object') continue;
    eleNo += 1;
    const parent = nodeMap.get(String(p.propertiesPID ?? '')) || root;
    const item = {
      no: eleNo,
      name: String(p.propertiesName || p.realLabel || '').trim() || '(无名称)',
      action: actionTag(String(p.eventTypeValue || p.eventTypeName || '').trim()),
      actionValue: String(p.eventTypeValue || '').trim(),
      regionId: String(p.regionId || '').trim(),
      hasBbox: !!(p.rect && p.rect.x2 > p.rect.x1 && p.rect.y2 > p.rect.y1),
    };
    // PID 链已表达分区层级：pid 命中中间节点（section/tab/wizard/card）则直接挂，不再 regionId 拆段
    if (parent !== root && V3_INTERMEDIATE_ROLES.has(parent.role)) {
      parent.items.push(item);
      continue;
    }
    // fallback（旧数据无中间节点 / pid 直指 page-popup / pid 未命中）：regionId 拆段建中间层
    const regionId = String(p.regionId || '').trim();
    const segs = regionId
      .split('|').map((s) => s.trim()).filter(Boolean)
      .map((seg) => {
        const i = seg.indexOf(':');
        return i > 0
          ? { role: seg.slice(0, i).trim(), label: seg.slice(i + 1).trim() }
          : { role: 'section', label: seg };
      });
    let cur = parent;
    let key = parent.id ? `shot:${parent.id}` : 'root';
    for (const s of segs) {
      if (!s.label) continue;
      // 页面/弹窗节点已经由截图条目表达，避免 region_id 前缀再生成重复层
      if (cur.role === 'page' && s.role === 'page') continue;
      if (cur.role === 'dialog' && (s.role === 'page' || s.role === 'dialog' || s.role === 'overlay')) continue;
      key += '|' + s.role + ':' + s.label;
      let child = (cur.children ||= []).find((c) => c.key === key);
      if (!child) {
        child = { role: s.role, label: s.label, key, children: [], items: [] };
        cur.children.push(child);
      }
      cur = child;
    }
    cur.items.push(item);
  }
  return root;
}

/** 从阶段截图 metadata.elements[] 按 layers（外→内）聚合分层树；叶 = 控件对象。 */
export function buildTreeFromElements(elements) {
  const root = { role: 'page', label: '阶段页面', children: [], items: [] };
  const map = new Map();
  map.set('', root);
  (elements || []).forEach((e, i) => {
    const layers = Array.isArray(e.layers) ? e.layers : [];
    let parent = root;
    let key = '';
    for (const l of layers) {
      key += '|' + (l.role || '?') + ':' + (l.label || '');
      if (!map.has(key)) {
        const n = { role: l.role, label: l.label, children: [], items: [] };
        map.set(key, n);
        parent.children.push(n);
      }
      parent = map.get(key);
    }
    parent.items.push({
      no: i + 1,
      name: String(e.label || '').trim() || '(无文本)',
      action: kindTag(String(e.kind || '').trim()),
      actionValue: String(e.kind || '').trim(),
      regionId: String(e.regionId || ''),
    });
  });
  return root;
}

/** 从步骤（trajectory_step.element_json）构建分层树；叶 = 操作步骤。
 *  分层路径：优先 el.layers[]（外→内），否则 el.region_id 按 '|' 拆段（role:label）。 */
export function buildTreeFromSteps(steps) {
  const root = { role: 'page', label: '交易操作', children: [], items: [] };
  const map = new Map();
  map.set('', root);
  (steps || []).forEach((s, i) => {
    const segs = [];
    if (Array.isArray(s.layers) && s.layers.length) {
      for (const l of s.layers) segs.push({ role: String(l.role || 'section').trim(), label: String(l.label || '').trim() });
    } else {
      const rid = String(s.regionId || '').trim();
      for (const seg of rid.split('|').map((x) => x.trim()).filter(Boolean)) {
        const j = seg.indexOf(':');
        segs.push(j > 0
          ? { role: seg.slice(0, j).trim(), label: seg.slice(j + 1).trim() }
          : { role: 'section', label: seg });
      }
    }
    let parent = root;
    let key = '';
    for (const g of segs) {
      if (!g.label) continue;
      key += '|' + g.role + ':' + g.label;
      if (!map.has(key)) {
        const n = { role: g.role, label: g.label, children: [], items: [] };
        map.set(key, n);
        parent.children.push(n);
      }
      parent = map.get(key);
    }
    parent.items.push({
      no: i + 1,
      name: s.label || '(无标签)',
      action: s.action,
      actionValue: s.actionValue || s.action,
      regionId: s.regionId || '',
      hasBbox: !!s.hasBbox,
    });
  });
  return root;
}

/** 递归渲染树为 HTML 字符串（fc-tree 风格，可折叠：层级节点带 chevron + children 容器）。
 *  items（叶子）与 children（子分支）统一包进 .tree-children 容器——所有分支都可折叠。
 *  有 node.entries（V3 groups 时间线顺序）时按 entries 交错渲染（弹窗组紧跟触发按钮）。 */
function treeToHtml(node, depth) {
  const pad = 8 + depth * 18;
  const [cls, label] = roleInfo(node.role);
  const hasContent = node.items.length > 0 || node.children.length > 0;
  const leafCount = node.items.length + node.children.reduce((n, c) => n + c.items.length, 0);
  const chev = hasContent
    ? `<span class="tree-chevron" data-chevron="1">▾</span>`
    : `<span class="tree-chevron tree-chevron-empty"></span>`;
  const leafHtml = (it) => `<div class="tree-node tree-leaf" data-depth="${depth + 1}" style="padding-left:${pad + 26}px" `
    + `title="${esc('regionId: ' + (it.regionId || '(无)') + ' | eventType: ' + (it.actionValue || it.action))}">`
    + `<span class="tree-step-no">${it.no}</span>`
    + `<span class="tree-object-tag">${esc(it.action)}</span>`
    + `<span class="tree-name">${esc(it.name)}</span>`
    + (it.hasBbox ? `<span class="tree-bbox-tag">bbox</span>` : '')
    + `</div>`;
  let html = `<div class="tree-node tree-branch" data-depth="${depth}" style="padding-left:${pad}px">`
    + chev
    + `<span class="tree-level-type ${cls}">${esc(label)}</span>`
    + `<span class="tree-colon">：</span>`
    + `<span class="tree-name">${esc(node.label || '(未命名)')}</span>`
    + (leafCount ? `<span class="tree-count">${leafCount}</span>` : '')
    + `</div>`;
  if (hasContent) {
    html += `<div class="tree-children">`;
    if (Array.isArray(node.entries) && node.entries.length) {
      for (const e of node.entries) {
        if (e.kind === 'item') html += leafHtml(node.items[e.index]);
        else if (e.kind === 'child' && node.children[e.index]) html += treeToHtml(node.children[e.index], depth + 1);
      }
    } else {
      for (const it of node.items) html += leafHtml(it);
      for (const c of node.children) html += treeToHtml(c, depth + 1);
    }
    html += `</div>`;
  }
  return html;
}

/** 从 V3 result.groups（扁平 pid 树）构建分层树：page 组为根 → dialog 组/控件挂 pid。
 *  控件与弹窗组按 groups 数组顺序（= 操作时间线）记录在 node.entries，
 *  渲染时弹窗组紧跟其触发按钮之后（而非全部排在控件末尾）。 */
export function buildTreeFromGroups(groups) {
  const root = { role: 'page', label: '交易页面', children: [], items: [] };
  const byId = new Map();
  byId.set('', root);
  for (const g of groups || []) {
    if (g.type === 'page') byId.set(g.id, { role: 'page', label: g.name || g.id, children: [], items: [] });
    else if (g.type === 'dialog') byId.set(g.id, { role: 'dialog', label: g.name || g.id, children: [], items: [] });
  }
  for (const g of groups || []) {
    if (g.type === 'page') root.children.push(byId.get(g.id));
    else if (g.type === 'dialog') (byId.get(g.pid) || root).children.push(byId.get(g.id));
  }
  // 单循环按 groups 数组顺序（= 时间线）交错记录 items/children entries
  for (const g of groups || []) {
    const parent = byId.get(g.pid) || root;
    if (g.type === 'ele') {
      const item = {
        no: String(g.id || '').replace('step-', '') || 0,
        name: g.propertiesName || g.label || g.id || '(无名称)',
        action: g.kind || g.action || '操作',
        actionValue: g.kind || '',
        regionId: '',
        hasBbox: !!g.rect,
      };
      parent.items.push(item);
      (parent.entries ||= []).push({ kind: 'item', index: parent.items.length - 1 });
    } else if (g.type === 'dialog') {
      const childNode = byId.get(g.id);
      const childIdx = childNode ? parent.children.indexOf(childNode) : -1;
      if (childIdx >= 0) (parent.entries ||= []).push({ kind: 'child', index: childIdx });
    }
  }
  return root;
}

function buildHtml({ properties, steps, elements, groups, title }) {
  let tree;
  let list;
  let unit;
  let sectionCount = 0;
  if (Array.isArray(groups)) {
    tree = buildTreeFromGroups(groups);
    list = groups.filter((g) => g.type === 'ele');
    unit = '控件';
  } else if (Array.isArray(elements)) {
    tree = buildTreeFromElements(elements);
    list = elements;
    unit = '元素';
  } else if (Array.isArray(steps)) {
    tree = buildTreeFromSteps(steps);
    list = steps;
    unit = '步骤';
  } else if (Array.isArray(properties) && properties.some((p) => p && (V3_SHOT_TYPES.has(p.type) || V3_INTERMEDIATE_TYPES.has(p.type) || p.type === 'object'))) {
    tree = buildTreeFromV3Flat(properties);
    list = properties.filter((p) => p.type === 'object');
    unit = '控件';
    sectionCount = properties.filter((p) => V3_INTERMEDIATE_TYPES.has(p.type)).length;
  } else {
    tree = buildTreeFromProperties(properties);
    list = properties || [];
    unit = '操作';
  }
  const unzoned = list.filter((p) => !String(p.regionId || '').trim() && !(Array.isArray(p.layers) && p.layers.length)).length;
  const sectionLabel = sectionCount ? ` · 分区 ${sectionCount}` : '';
  const treeHtml = treeToHtml(tree, 0);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>元素分层 · ${esc(title)}</title>
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
  .tree-branch { cursor: pointer; user-select: none; }
  .tree-chevron { width: 14px; flex-shrink: 0; color: #8c8c8c; font-size: 11px; text-align: center; }
  .tree-chevron-empty { visibility: hidden; }
  .tree-children.collapsed { display: none; }
  .tree-count { font-size: 11px; color: #bfbfbf; margin-left: 6px; flex-shrink: 0; }
  .tree-bbox-tag { font-size: 11px; color: #389e0d; background: #f6ffed; border: 1px solid #b7eb8f;
                   border-radius: 2px; padding: 0 4px; line-height: 16px; flex-shrink: 0; }
  .tree-leaf.hidden, .tree-branch.hidden { display: none; }
  .tree-leaf.hit { background: #fffbe6; }
  .tree-level-type { font-size: 11px; padding: 0 6px; border-radius: 2px; color: #fff;
                     font-weight: 500; line-height: 18px; flex-shrink: 0; }
  .tree-level-type.page { background: #1890ff; }
  .tree-level-type.tab { background: #52c41a; }
  .tree-level-type.popup { background: #fa8c16; }
  .tree-level-type.section { background: #722ed1; }
  .tree-level-type.wizard { background: #13c2c2; }
  .tree-level-type.card { background: #597ef7; }
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
  <b>元素分层</b>
  <span class="dim">${esc(title)} · ${unit} ${list.length}${sectionLabel} · 未分区 ${unzoned}</span>
  <label class="dim">搜索 <input id="treeSearch" type="text" placeholder="名称 / 动作 / 层级" style="width:180px"></label>
  <button type="button" id="expandAll">全部展开</button>
  <button type="button" id="collapseAll">全部收起</button>
  <span class="dim" id="treeStat"></span>
</div>
<div class="wrap">
  <div class="tree-panel">
    <div class="tree-title">${unit === '元素' ? '阶段页面元素（按 layers 分层）' : '操作步骤（按 region 分层）'}</div>
    <div class="tree-list" id="treeList">${treeHtml}</div>
  </div>
</div>
<script>
  (() => {
    const list = document.getElementById('treeList');
    const stat = document.getElementById('treeStat');
    // 折叠：点击分支节点（不点叶子）toggle 其 tree-children 容器
    list.addEventListener('click', (ev) => {
      const branch = ev.target.closest('.tree-branch');
      if (!branch) return;
      const kids = branch.nextElementSibling;
      if (!kids || !kids.classList.contains('tree-children')) return;
      const collapsed = kids.classList.toggle('collapsed');
      const chev = branch.querySelector('.tree-chevron');
      if (chev) chev.textContent = collapsed ? '▸' : '▾';
    });
    const setAll = (collapsed) => {
      for (const kids of list.querySelectorAll('.tree-children')) {
        const collapsedNow = kids.classList.toggle('collapsed', collapsed);
        const branch = kids.previousElementSibling;
        const chev = branch && branch.querySelector('.tree-chevron');
        if (chev) chev.textContent = collapsedNow ? '▸' : '▾';
      }
    };
    document.getElementById('collapseAll').addEventListener('click', () => setAll(true));
    document.getElementById('expandAll').addEventListener('click', () => setAll(false));
    // 搜索：过滤叶子（自身文本或任意祖先层级名含关键词），命中高亮并自动展开祖先
    const search = document.getElementById('treeSearch');
    search.addEventListener('input', () => {
      const kw = search.value.trim().toLowerCase();
      const leaves = [...list.querySelectorAll('.tree-leaf')];
      const branches = [...list.querySelectorAll('.tree-branch')];
      const ancestors = (leaf) => {
        const acc = [];
        let el = leaf.parentElement;
        while (el) {
          if (el.classList.contains('tree-children')) {
            const br = el.previousElementSibling;
            if (br && br.classList.contains('tree-branch')) acc.push(br);
            el = br;
          } else {
            el = el.parentElement;
          }
        }
        return acc;
      };
      if (!kw) {
        for (const el of leaves) el.classList.remove('hidden', 'hit');
        for (const el of branches) el.classList.remove('hidden');
        setAll(false);
        stat.textContent = '';
        return;
      }
      for (const el of leaves) {
        const hit = (el.textContent || '').toLowerCase().includes(kw)
          || ancestors(el).some((b) => (b.textContent || '').toLowerCase().includes(kw));
        el.classList.toggle('hidden', !hit);
        el.classList.toggle('hit', hit);
      }
      for (const el of branches) {
        // 分支在其后代叶子有命中时显示（展开祖先链）
        let kids = el.nextElementSibling;
        let hasHit = false;
        while (kids && kids.classList.contains('tree-children')) {
          hasHit = hasHit || [...kids.querySelectorAll('.tree-leaf:not(.hidden)')].length > 0;
          kids = kids.nextElementSibling && kids.nextElementSibling.classList.contains('tree-children')
            ? kids.nextElementSibling : null;
        }
        if (hasHit) {
          el.classList.remove('hidden');
          const ch = el.nextElementSibling;
          if (ch && ch.classList.contains('tree-children')) ch.classList.remove('collapsed');
          const chev = el.querySelector('.tree-chevron');
          if (chev) chev.textContent = '▾';
        } else {
          el.classList.add('hidden');
        }
      }
      const shown = leaves.filter((l) => !l.classList.contains('hidden')).length;
      stat.textContent = \`命中 \${shown} / \${leaves.length}\`;
    });
  })();
</script>
</body>
</html>`;
}

function main() {
  const file = argValue('--file');
  const shot = argValue('--shot');
  const trajectory = argValue('--trajectory');
  const phase = argValue('--phase');
  const v3File = argValue('--v3');
  if (v3File) return runV3Mode(v3File);
  const modes = [file, shot, trajectory].filter(Boolean).length;
  if (!modes || modes > 1) {
    console.error('用法（四选一）：--file <export.json> | --shot <screenshotId> | --trajectory <id> [--phase <phaseNumber>] | --v3 <payload.json>（兼容 V3.0 groups / V3.1 flat）');
    process.exit(1);
  }
  if (shot) return runShotMode(Number(shot));
  if (trajectory) return runTrajectoryMode(Number(trajectory), phase ? Number(phase) : null);

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
  const properties = parseRectStrings(entry.transcationProperties || []);
  const title = String(entry.transcationName || '').trim() || file;

  const html = buildHtml({ properties, title });
  const base = String(file).split(/[\\/]/).pop().replace(/\.[^.]+$/, '') || 'props';
  const out = join(ROOT, 'tmp', `layer-tree-${base}.html`);
  writeFileSync(out, html, 'utf8');
  const isV3Flat = properties.some((p) => p && (V3_SHOT_TYPES.has(p.type) || V3_INTERMEDIATE_TYPES.has(p.type) || p.type === 'object'));
  const shots = isV3Flat ? properties.filter((p) => V3_SHOT_TYPES.has(p.type)) : [];
  const sections = isV3Flat ? properties.filter((p) => V3_INTERMEDIATE_TYPES.has(p.type)) : [];
  const eles = isV3Flat ? properties.filter((p) => p.type === 'object') : properties;
  const unzoned = eles.filter((p) => !String(p.regionId || '').trim()).length;
  console.log(`已生成: ${out}`);
  console.log(`交易: ${title} | ${isV3Flat ? `截图 ${shots.length} | 分区 ${sections.length} | 控件 ${eles.length}` : `操作 ${properties.length} 步`} | 未分区 ${unzoned}`);
}

/** 直接按步骤分层（trajectory_step.element_json 的 layers/region_id），不依赖阶段截图。 */
async function runTrajectoryMode(trajectoryId, phaseNumber) {
  const db = getDB();
  const traj = await db('trajectory').select('id', 'name').where({ id: trajectoryId }).first();
  if (!traj) {
    console.error(`未找到交易 #${trajectoryId}`);
    await db.destroy();
    process.exit(1);
  }
  let phaseQuery = db('trajectory_phase').select('id', 'phase_number').where({ trajectory_id: trajectoryId }).orderBy('phase_number');
  if (phaseNumber != null) phaseQuery = phaseQuery.where({ phase_number: phaseNumber });
  const phases = await phaseQuery;
  if (!phases.length) {
    console.error(`交易 #${trajectoryId} 无阶段${phaseNumber != null ? `（phase ${phaseNumber}）` : ''}`);
    await db.destroy();
    process.exit(1);
  }
  const steps = [];
  const phaseIds = phases.map((p) => p.id);
  const stepRows = await db('trajectory_step')
    .select('phase_number', 'step_number', 'action_type', 'element_json')
    .whereIn('trajectory_phase_id', phaseIds)
    .orderBy('id');
  for (const s of stepRows) {
    let el = null;
    try { el = typeof s.element_json === 'string' ? JSON.parse(s.element_json) : s.element_json; } catch {}
    const label = String(el?.formLabel ?? el?.label ?? el?.matchedLabel ?? el?.text ?? '').trim();
    const actionValue = String(el?.target_kind ?? s.action_type ?? '').trim();
    const bbox = el?.bbox;
    const hasBbox = !!bbox && typeof bbox === 'object'
      && Number.isFinite(Number(bbox.x1)) && Number(bbox.x2) > Number(bbox.x1)
      && Number(bbox.y2) > Number(bbox.y1);
    steps.push({
      no: s.step_number ?? s.phase_number ?? 0,
      label: label || '(无标签)',
      action: actionTag(actionValue),
      actionValue,
      regionId: String(el?.region_id ?? '').trim(),
      layers: Array.isArray(el?.layers) ? el.layers : null,
      hasBbox,
    });
  }
  const title = `${traj.name} · phase ${phases.map((p) => p.phase_number).join(',')}`;
  const html = buildHtml({ steps, title });
  const out = join(ROOT, 'tmp', `layer-tree-traj-${trajectoryId}${phaseNumber != null ? `-p${phaseNumber}` : ''}.html`);
  writeFileSync(out, html, 'utf8');
  console.log(`已生成: ${out}`);
  console.log(`${title} | 步骤 ${steps.length} | 未分区 ${steps.filter((s) => !String(s.regionId || '').trim() && !(s.layers && s.layers.length)).length}`);
  await db.destroy();
}

async function runShotMode(screenshotId) {
  const db = getDB();
  const row = await db('screenshot')
    .select('id', 'trajectory_id', 'trajectory_phase_id', 'metadata_json')
    .where({ id: screenshotId })
    .first();
  if (!row) {
    console.error(`未找到截图 #${screenshotId}`);
    await db.destroy();
    process.exit(1);
  }
  const meta = typeof row.metadata_json === 'string' ? JSON.parse(row.metadata_json) : row.metadata_json;
  const elements = (meta?.elements || []).filter((e) => e && e.rect);
  if (!elements.length) {
    console.error(`截图 #${screenshotId} 无 elements`);
    await db.destroy();
    process.exit(1);
  }
  const title = `截图 #${screenshotId} · traj ${row.trajectory_id} · phase ${row.trajectory_phase_id}`;
  const props = elements.map((e) => ({ regionId: e.regionId || '' }));
  const unzoned = props.filter((p) => !String(p.regionId || '').trim()).length;
  const html = buildHtml({ properties: null, elements, title });
  const out = join(ROOT, 'tmp', `layer-tree-shot-${screenshotId}.html`);
  writeFileSync(out, html, 'utf8');
  console.log(`已生成: ${out}`);
  console.log(`${title} | 元素 ${elements.length} | 带分层 ${elements.length - unzoned} | 未分区 ${unzoned}`);
  await db.destroy();
}

/** V3 模式：读 V3 批量推送 payload。
 *  兼容 V3.0 result.groups 和 V3.1 flat transcationProperties 两种结构。 */
function runV3Mode(file) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error('读取/解析 V3 payload 失败:', err.message);
    process.exit(1);
  }
  const data = raw?.data ?? raw;
  const entry = data?.payload?.transcationEventTypeList?.[0];
  const result = entry?.result;
  if (result && Array.isArray(result.groups) && result.groups.length) {
    const groups = result.groups;
    const title = `V3.0 · ${result.name || entry?.transcationName || result.id || file}`;
    const html = buildHtml({ groups, title });
    const base = String(result.id || 'payload').replace(/[^A-Za-z0-9_-]/g, '_');
    const out = join(ROOT, 'tmp', `layer-tree-v3-${base}.html`);
    writeFileSync(out, html, 'utf8');
    const eles = groups.filter((g) => g.type === 'ele');
    const pages = groups.filter((g) => g.type === 'page');
    const dialogs = groups.filter((g) => g.type === 'dialog');
    console.log(`已生成: ${out}`);
    console.log(`${title} | 页面组 ${pages.length} | 弹窗组 ${dialogs.length} | 控件 ${eles.length}（带 bbox ${eles.filter((e) => e.rect).length}）`);
    return;
  }

  const properties = parseRectStrings(entry?.transcationProperties);
  if (Array.isArray(properties) && properties.some((p) => p && (V3_SHOT_TYPES.has(p.type) || V3_INTERMEDIATE_TYPES.has(p.type) || p.type === 'object'))) {
    const title = `V3.1 · ${entry?.transcationName || file}`;
    const html = buildHtml({ properties, title });
    const base = String(entry?.transcId || 'payload').replace(/[^A-Za-z0-9_-]/g, '_');
    const out = join(ROOT, 'tmp', `layer-tree-v3-${base}.html`);
    writeFileSync(out, html, 'utf8');
    const shots = properties.filter((p) => V3_SHOT_TYPES.has(p.type));
    const sections = properties.filter((p) => V3_INTERMEDIATE_TYPES.has(p.type));
    const eles = properties.filter((p) => p.type === 'object');
    const withRect = eles.filter((p) => p.rect && Object.keys(p.rect).length > 0).length;
    console.log(`已生成: ${out}`);
    console.log(`${title} | 截图条目 ${shots.length}（page/popup）| 分区 ${sections.length} | 控件 ${eles.length}（带 rect ${withRect}）`);
    return;
  }

  console.error('V3 payload 既无 result.groups，也无新版 transcationProperties type 条目（page/popup/object）');
  process.exit(1);
}

if (isDirectRun()) {
  main();
}