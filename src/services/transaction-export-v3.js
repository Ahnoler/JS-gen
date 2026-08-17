/**
 * V3 partner transaction export — 阶段长图控件点亮（对齐消费方 groups 约定）。
 *
 * 与 V2.0（transaction-export.js）差异：
 *   - entry 新增 `result`：{ id, name, url, groups[] }——组节点 page/dialog + 控件节点 ele，
 *     pid 树；控件带 rect（内容坐标，来自 element_json.bbox）+ target/kind/params 等；
 *   - 一张长图 = 一个页面组（当前每阶段一张长图 → 每阶段一个 page-<n> 组，组间平级）；
 *   - 弹窗 = 独立页面（dialog 组，附属于触发按钮 anchor）；第一版弹窗控件 rect 相对阶段长图；
 *   - phases[].metadata 全量元素不再推送；transcationProperties 保留（控件组）。
 *
 * TODO: 同阶段多页面区分——当前一张长图=一个页面组（每阶段一个）；未来按步骤 URL
 *       切分同一阶段内的多个页面（需录制时记录步骤 URL）。
 */
import { mapStepToTransactionEvent, uniquifyPropertiesNames } from './transaction-export.js';
import { SKIP_ACTIONS } from './legacy-engine-export.js';

export const TRANSACTION_SCHEMA_VERSION_V3 = 3;

/** action_type → 同事格式的 {command, action}；未映射保留原名。 */
const ACTION_MAP = Object.freeze({
  fill_form_field: ['input', 'input'],
  select_option: ['select', 'select'],
  select_tree_option: ['select', 'select'],
  fill_date_field: ['fill_date_field', 'fill_date_field'],
  select_date: ['fill_date_field', 'fill_date_field'],
  click_element_by_index: ['click', 'click_element_by_index'],
  click_menu_item: ['click', 'click'],
  click_adjacent_button: ['click', 'click'],
  click_table_row_button: ['click', 'click'],
  click_table_row_radio: ['click', 'click'],
  click_radio: ['click', 'click'],
  click_icon_button: ['click', 'click'],
  click_save: ['click', 'click'],
  switch_tab: ['click', 'click'],
  close_dialog: ['click', 'close'],
});

/** target_kind → 同事格式的 kind；未映射保留原名。 */
const KIND_MAP = Object.freeze({
  form_input: 'input',
  form_select: 'select',
  form_date: 'date',
  form_tree_select: 'tree',
  form_radio: 'radio',
  form_checkbox: 'checkbox',
  button: 'button',
  menu: 'menu',
  table_row_button: 'button',
  tree_node: 'tree',
  tab: 'tab',
  submenu: 'menu',
  icon: 'icon',
  breadcrumb: 'breadcrumb',
  card: 'card',
  collapse: 'collapse',
  dialog: 'dialog',
  drawer: 'drawer',
});

export function mapControlAction(actionType) {
  const m = ACTION_MAP[actionType];
  return m ? { command: m[0], action: m[1] } : { command: actionType || '', action: actionType || '' };
}

export function mapControlKind(targetKind) {
  return KIND_MAP[targetKind] || targetKind || '';
}

/** region_id 分层链（'|' 分段，role:label）中含 overlay 段 → 返回该段；否则 null。 */
export function isOverlayRegion(regionId) {
  const rid = String(regionId || '').trim();
  if (!rid) return null;
  for (const seg of rid.split('|').map((s) => s.trim()).filter(Boolean)) {
    const i = seg.indexOf(':');
    if (i > 0 && seg.slice(0, i).trim() === 'overlay') {
      return { role: 'overlay', label: seg.slice(i + 1).trim() };
    }
  }
  return null;
}

function parseJson(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseStepElement(step) {
  const el = parseJson(step?.elementJson);
  return el && typeof el === 'object' ? el : null;
}

/** 合法 rect 判定：四值有限且 x2>x1、y2>y1。 */
function isLegalRect(bbox) {
  return !!bbox && typeof bbox === 'object'
    && Number.isFinite(Number(bbox.x1)) && Number.isFinite(Number(bbox.y1))
    && Number.isFinite(Number(bbox.x2)) && Number.isFinite(Number(bbox.y2))
    && Number(bbox.x2) > Number(bbox.x1) && Number(bbox.y2) > Number(bbox.y1);
}

/**
 * 构建一个控件节点（type: ele）。
 * @returns {object} 控件节点；rect 仅当 element_json.bbox 合法时输出。
 */
export function buildControlNode(step, el, params, { pid, group, anchor, scanIndex } = {}) {
  const label = String(el.formLabel ?? el.text ?? el.matchedLabel ?? '').trim();
  const { command, action } = mapControlAction(String(step?.actionType ?? ''));
  const attrs = el.attributes && typeof el.attributes === 'object' ? el.attributes : {};
  const node = {
    id: step?.stepNumber != null ? `step-${step.stepNumber}` : `step-${(scanIndex ?? 0) + 1}`,
    command,
    action,
    target: String(el.xpath_smart ?? el.xpath_full ?? el.xpath ?? '').trim(),
    targetType: 'xpath',
    tagName: String(el.tag ?? el.tagName ?? '').trim() || 'input',
    kind: mapControlKind(String(el.target_kind ?? '')),
    propertiesName: label,
    label,
    placeholder: String(attrs.placeholder ?? ''),
    title: String(attrs.title ?? ''),
    value: String(params?.value ?? '').trim(),
    disabled: !!attrs.disabled,
    required: !!attrs.required,
    readonly: !!attrs.readonly,
    type: 'ele',
    group: Array.isArray(group) ? group : [],
    options: Array.isArray(el.options) ? el.options : [],
    timestamp: step?.createdAt ? new Date(step.createdAt).getTime() : 0,
    scanIndex: scanIndex ?? 0,
    recorded: true,
    manualRecord: String(step?.source ?? '') === 'manual',
    pid,
    params: params && typeof params === 'object' ? params : {},
  };
  if (anchor && anchor.xpath) {
    node.anchorTarget = anchor.xpath;
    node.anchorPropertiesName = anchor.name || '';
  }
  if (isLegalRect(el.bbox)) {
    node.rect = {
      x1: Number(el.bbox.x1), y1: Number(el.bbox.y1),
      x2: Number(el.bbox.x2), y2: Number(el.bbox.y2),
    };
  }
  return node;
}

function groupStepsByPhase(steps = []) {
  const byPhase = {};
  for (const s of steps) {
    const pid = s?.trajectoryPhaseId != null ? Number(s.trajectoryPhaseId) : null;
    if (pid == null) continue;
    (byPhase[pid] ||= []).push(s);
  }
  return byPhase;
}

/**
 * 构建 result.groups 树（页面组 + 弹窗组 + 控件节点）。
 * @param {object} opts
 * @param {object} opts.traj 交易（含 id/name/url/steps）
 * @param {Array} [opts.phases] trajectory_phase 行（id/phaseNumber/description）
 * @param {Array} [opts.phaseScreenshots] screenshot 行（id/trajectoryPhaseId）
 * @param {object} [opts.stepsByPhase] {phaseId: steps[]}（缺省时从 traj.steps 分组）
 */
export function buildGroupsResult({ traj = {}, phases = [], phaseScreenshots = [], stepsByPhase = null } = {}) {
  const groups = [];
  const shotByPhase = new Map();
  for (const s of phaseScreenshots || []) {
    if (s?.trajectoryPhaseId != null && !shotByPhase.has(Number(s.trajectoryPhaseId))) {
      shotByPhase.set(Number(s.trajectoryPhaseId), s);
    }
  }
  const stepMap = stepsByPhase || groupStepsByPhase(traj.steps || []);
  const phaseList = [...(phases || [])]
    .sort((a, b) => Number(a.phaseNumber ?? a.phase_number ?? 0) - Number(b.phaseNumber ?? b.phase_number ?? 0));

  for (const phase of phaseList) {
    const phaseId = Number(phase.id);
    const phaseNumber = Number(phase.phaseNumber ?? phase.phase_number ?? 0);
    const shot = shotByPhase.get(phaseId) || null;
    const pageId = `page-${phaseNumber}`;
    const desc = String(phase.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
    groups.push({
      id: pageId,
      pid: null,
      type: 'page',
      key: pageId,
      name: `页面${phaseNumber}${desc ? ` · ${desc}` : ''}`,
      screenshots: shot
        ? [{ phaseNumber, url: `/api/v2/screenshots/${Number(shot.id)}/image` }]
        : [],
    });

    const dialogByTitle = new Map();
    let lastAnchor = null; // 弹窗 anchor 推断：最近的非弹窗 button/click 步骤
    const steps = stepMap[phaseId] || [];
    steps.forEach((step, idx) => {
      const el = parseStepElement(step);
      if (!el) return;
      const actionType = String(step?.actionType ?? '');
      if (SKIP_ACTIONS.has(actionType)) return; // 元动作（save_form_snapshot 等）不入 groups
      const overlay = isOverlayRegion(String(el.region_id ?? '').trim());
      const params = parseJson(step?.paramsJson);
      if (overlay) {
        const title = overlay.label || 'overlay';
        let dlg = dialogByTitle.get(title);
        if (!dlg) {
          const anchorXpath = lastAnchor?.xpath ?? '';
          const key = `${pageId}|dialog:${title}${anchorXpath ? `@@anchor=${anchorXpath}` : ''}`;
          dlg = { id: key, pid: pageId, type: 'dialog', key, name: title, screenshots: [] };
          dialogByTitle.set(title, dlg);
          groups.push(dlg);
        }
        groups.push(buildControlNode(step, el, params, {
          pid: dlg.id,
          group: [{ type: 'dialog', name: dlg.name, key: dlg.key }],
          anchor: lastAnchor,
          scanIndex: idx,
        }));
      } else {
        // TODO: 同阶段多页面区分——当前一张长图=一个页面组；未来按步骤 URL 切分页面组
        groups.push(buildControlNode(step, el, params, { pid: pageId, group: [], anchor: null, scanIndex: idx }));
        if ((actionType === 'click' || actionType.startsWith('click_')) && step?.success !== false) {
          lastAnchor = {
            xpath: String(el.xpath_smart ?? el.xpath_full ?? el.xpath ?? '').trim(),
            name: String(el.formLabel ?? el.text ?? el.matchedLabel ?? '').trim(),
          };
        }
      }
    });
  }

  return {
    id: traj.id != null ? `traj-${traj.id}` : '',
    name: String(traj.name ?? '').trim() || `trajectory-${traj.id}`,
    url: String(traj.url ?? '').trim() || '',
    groups,
  };
}

/**
 * Build one V3 transaction entry.
 * @returns {{ entry: object, count: number, skipped: object, stats: object }}
 */
export function buildTransactionEntryV3(traj, { systemId, projectId, phases, phaseScreenshots } = {}) {
  if (systemId == null || systemId === '' || projectId == null || projectId === '') {
    const err = new Error('systemId and projectId are required');
    err.statusCode = 400;
    throw err;
  }
  const properties = [];
  let metaActions = 0;
  for (const step of traj.steps || []) {
    const ev = mapStepToTransactionEvent(step);
    if (!ev) {
      metaActions += 1;
      continue;
    }
    const { _meta, ...publicEv } = ev;
    properties.push(publicEv);
  }
  uniquifyPropertiesNames(properties);

  const result = buildGroupsResult({ traj, phases, phaseScreenshots });
  const noRectControls = result.groups
    .filter((g) => g.type === 'ele' && !g.rect).length;

  const id = traj.id != null ? String(traj.id) : '';
  const name = String(traj.name || '').trim() || `trajectory-${id}`;

  return {
    entry: {
      transcId: id,
      transcationName: name,
      systemId: String(systemId),
      projectId: String(projectId),
      transcationType: 'web',
      testFrame: 'playwright',
      transcationProperties: properties,
      result,
    },
    count: properties.length,
    skipped: { metaActions },
    stats: { noRectControls },
  };
}

/**
 * Single-trajectory V3 importDemand body (always wraps list of length 1).
 */
export function buildTransactionPayloadV3(traj, opts = {}) {
  const built = buildTransactionEntryV3(traj, opts);
  return {
    payload: {
      transcationEventTypeList: [built.entry],
    },
    count: built.count,
    skipped: built.skipped,
    stats: built.stats,
  };
}

/**
 * Multi-trajectory V3 importDemand body.
 */
export function wrapTransactionListV3(builtEntries = []) {
  const list = [];
  let count = 0;
  let metaActions = 0;
  let noRectControls = 0;
  for (const b of builtEntries) {
    if (!b?.entry) continue;
    list.push(b.entry);
    count += Number(b.count) || 0;
    metaActions += Number(b.skipped?.metaActions) || 0;
    noRectControls += Number(b.stats?.noRectControls) || 0;
  }
  return {
    payload: { transcationEventTypeList: list },
    count,
    skipped: { metaActions },
    stats: { noRectControls },
  };
}
