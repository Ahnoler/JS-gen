/**
 * Structural capability-cohesion gate for req→draft-traj propose.
 * Classifies taskDraft step groups by generic verb families; never scene lists.
 */
import { isPersistBoundaryAction } from './flow-card-guide.js';

/** @typedef {'locate'|'persist'|'other'|'multi'|'neutral'} CapabilityRole */

const OTHER_FAMILIES = {
  reorder: ['上移', '下移', '置顶', '置底', '排序'],
  maintain: ['维护', '修改', '编辑', '填写', '录入'],
  create: ['新增', '添加', '创建', '新建'],
  delete: ['删除', '移除'],
  export: ['导出', '下载'],
  import: ['导入', '上传'],
  status: ['启用', '禁用'],
  clone: ['克隆', '复制'],
};

const PERSIST_AS_CAP_FAMILIES = new Set(['delete', 'status', 'clone']);
const PERSIST_AS_CAP_RE = /(?<![未已])启用|禁用|克隆|删除|作废|撤销(?!查询)/;
const CLOSER_RE = /确定|保存|提交/;
const STEP_DUNHAO_RE = /^\s*\d+、/;
const STEP_DOT_RE = /^\s*\d+[\.．]\s+/;

/**
 * Drop trailing 来源： / 关键数据 metadata so classification sees only steps.
 * @param {string} text Raw taskDraft
 * @returns {string} Body without metadata blocks
 */
function stripMetadata(text) {
  const lines = String(text || '').split(/\r?\n/);
  const kept = [];
  let skipYuan = false;
  let skipKey = false;
  for (const line of lines) {
    if (/^\s*关键数据/.test(line)) {
      skipKey = true;
      skipYuan = false;
      continue;
    }
    if (/^\s*来源：/.test(line)) {
      skipYuan = true;
      continue;
    }
    if (skipKey) continue;
    if (skipYuan) continue;
    kept.push(line);
  }
  return kept.join('\n');
}

/**
 * True when haystack has a non-whitespace character.
 * @param {string} text Candidate
 * @returns {boolean} Visible
 */
function isVisible(text) {
  return String(text || '').replace(/\s+/g, '').length > 0;
}

/**
 * Haystack is text after 操作：/操作:, else the whole group.
 * @param {string} raw Group text
 * @returns {string} Classification haystack
 */
function extractHaystack(raw) {
  const src = String(raw || '');
  const idx = src.search(/操作[:：]/);
  if (idx >= 0) {
    const mark = src.slice(idx).match(/^操作[:：]/);
    return src.slice(idx + (mark ? mark[0].length : 0));
  }
  return src;
}

/**
 * Split a taskDraft into numbered step groups (spec §4.1).
 * @param {unknown} taskDraft Atom taskDraft text
 * @returns {Array<{ raw: string, haystack: string }>} Non-empty groups
 */
export function parseTaskDraftStepGroups(taskDraft) {
  const body = stripMetadata(String(taskDraft || ''));
  const lines = body.split(/\r?\n/);
  const starts = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (STEP_DUNHAO_RE.test(lines[i]) || STEP_DOT_RE.test(lines[i])) starts.push(i);
  }
  if (starts.length === 0) {
    const haystack = extractHaystack(body);
    if (!isVisible(haystack)) return [];
    return [{ raw: body, haystack }];
  }
  /** @type {Array<{ raw: string, haystack: string }>} */
  const groups = [];
  for (let g = 0; g < starts.length; g += 1) {
    const from = starts[g];
    const to = g + 1 < starts.length ? starts[g + 1] : lines.length;
    const raw = lines.slice(from, to).join('\n');
    const haystack = extractHaystack(raw);
    if (!isVisible(haystack)) continue;
    groups.push({ raw, haystack });
  }
  return groups;
}

/**
 * Other-family ids whose substrings hit haystack.
 * @param {string} haystack Group action text
 * @returns {Set<string>} Family ids
 */
function detectOtherFamilies(haystack) {
  /** @type {Set<string>} */
  const found = new Set();
  for (const [id, words] of Object.entries(OTHER_FAMILIES)) {
    if (id === 'status') {
      if (/(?<![未已])启用/.test(haystack) || haystack.includes('禁用')) found.add('status');
      continue;
    }
    if (words.some((w) => haystack.includes(w))) found.add(id);
  }
  return found;
}

/**
 * True when haystack has a persist-as-capability verb (not closer-only).
 * @param {string} haystack Group action text
 * @returns {boolean} Persist-as-capability
 */
function hasPersistAsCapability(haystack) {
  if (!isPersistBoundaryAction(haystack)) return false;
  return PERSIST_AS_CAP_RE.test(haystack);
}

/**
 * True when haystack is a closer tail: 确定/保存/提交, no other family, no persist-as-capability.
 * Prose around the closer (一次…成功) is allowed.
 * @param {string} haystack Group action text
 * @returns {boolean} Closer-only persist
 */
function isCloserOnlyPersistHaystack(haystack) {
  const src = String(haystack || '');
  if (!CLOSER_RE.test(src)) return false;
  if (detectOtherFamilies(src).size > 0) return false;
  if (hasPersistAsCapability(src)) return false;
  return true;
}

/**
 * Locate-prep whitelist (spec §4.2 A). `打开`/`进入` count only when no other-family hit.
 * @param {string} haystack Group action text
 * @param {boolean} hasOtherFamily Whether an other family already hit
 * @returns {boolean} Locate-prep
 */
function hasLocatePrep(haystack, hasOtherFamily) {
  const tokens = [
    '查询', '搜索', '过滤', '筛选', '选中',
    '点击行', '点击节点', '点行', '点选节点',
    '展开', '切换页签', '切页签',
    '等待加载', '等待', '加载', '刷新',
  ];
  if (tokens.some((w) => haystack.includes(w))) return true;
  for (const line of haystack.split(/\r?\n/)) {
    if (line.includes('点击') && (line.includes('行') || line.includes('节点'))) return true;
    if (line.includes('切换') && (line.includes('页签') || /tab/i.test(line))) return true;
  }
  if (!hasOtherFamily && (haystack.includes('打开') || haystack.includes('进入'))) return true;
  return false;
}

/**
 * Classify one group's haystack (spec §4.2).
 * @param {unknown} haystack Group action text
 * @returns {{ role: CapabilityRole, families: string[] }} Role plus pre-absorb family ids
 */
export function inspectCapabilityGroup(haystack) {
  const src = String(haystack || '');
  const families = detectOtherFamilies(src);
  const familyList = [...families];
  const closer = CLOSER_RE.test(src);
  const persistCap = hasPersistAsCapability(src);
  let working = new Set(families);
  if (working.size === 1) {
    const only = [...working][0];
    if (PERSIST_AS_CAP_FAMILIES.has(only) && persistCap) working = new Set();
  }
  /** @type {CapabilityRole} */
  let role;
  if (working.size >= 2) role = 'multi';
  else if (working.size === 1) role = 'other';
  else if (persistCap || closer) role = 'persist';
  else if (hasLocatePrep(src, familyList.length > 0)) role = 'locate';
  else role = 'neutral';
  return { role, families: familyList };
}

/**
 * Classify one group's haystack to a single role.
 * @param {unknown} haystack Group action text
 * @returns {CapabilityRole} Role
 */
export function classifyCapabilityGroup(haystack) {
  return inspectCapabilityGroup(haystack).role;
}

/**
 * Sequence rules (spec §4.3). Does not rewrite taskDraft.
 * @param {Array<{ haystack: string }>} groups Parsed groups
 * @returns {{ ok: true }|{ ok: false, reason: 'multi_capability_task_draft' }} Sequence pass or locked reject reason
 */
function assertSequence(groups) {
  const roles = groups.map((g) => classifyCapabilityGroup(g.haystack));
  if (roles.some((r) => r === 'multi')) {
    return { ok: false, reason: 'multi_capability_task_draft' };
  }
  const otherIdx = [];
  for (let i = 0; i < roles.length; i += 1) {
    if (roles[i] === 'other') otherIdx.push(i);
  }
  if (otherIdx.length > 1) {
    return { ok: false, reason: 'multi_capability_task_draft' };
  }
  let mainIdx = otherIdx.length === 1
    ? otherIdx[0]
    : roles.findIndex((r) => r === 'persist');
  if (mainIdx < 0) return { ok: true };
  for (let i = 0; i < mainIdx; i += 1) {
    if (roles[i] !== 'locate' && roles[i] !== 'neutral') {
      return { ok: false, reason: 'multi_capability_task_draft' };
    }
  }
  const mainHay = groups[mainIdx].haystack;
  const mainIsPersistCap = hasPersistAsCapability(mainHay);
  let i = mainIdx + 1;
  if (i < roles.length && roles[i] === 'persist' && isCloserOnlyPersistHaystack(groups[i].haystack)) {
    const mainRole = roles[mainIdx];
    if (mainRole === 'other' || mainIsPersistCap) i += 1;
    else return { ok: false, reason: 'multi_capability_task_draft' };
  }
  for (; i < roles.length; i += 1) {
    if (roles[i] === 'locate' || roles[i] === 'neutral') continue;
    return { ok: false, reason: 'multi_capability_task_draft' };
  }
  return { ok: true };
}

/**
 * Hard-gate one materialized atom (spec §4). Does not rewrite taskDraft.
 * @param {{ title?: unknown, taskDraft?: unknown, produces?: unknown }} atom Title, draft, normalized produces
 * @returns {{ ok: true }|{ ok: false, reason: 'multi_capability_task_draft'|'produces_eq_title' }} Gate pass or locked reject reason
 */
export function assertCapabilityCohesion(atom) {
  const groups = parseTaskDraftStepGroups(atom?.taskDraft);
  const seq = assertSequence(groups);
  if (!seq.ok) return seq;
  return { ok: true };
}
