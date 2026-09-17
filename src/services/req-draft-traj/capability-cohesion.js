/**
 * Structural capability-cohesion gate for req→draft-traj propose.
 * Classifies taskDraft step groups by generic verb families; never scene lists.
 */
import { isPersistBoundaryAction } from './flow-card-guide.js';

/** @typedef {'locate'|'persist'|'other'|'multi'|'neutral'} CapabilityRole */

const OTHER_FAMILIES = {
  reorder: ['上移', '下移', '置顶', '置底', '排序'],
  maintain: ['维护', '修改', '编辑'],
  create: ['新增', '添加', '创建', '新建'],
  delete: ['删除', '移除'],
  export: ['导出', '下载'],
  import: ['导入', '上传'],
  status: ['启用', '禁用'],
  clone: ['克隆', '复制'],
};

/** Page/dialog titles: 维护…主页/页面/界面/弹窗 — not a maintain capability. */
const MAINTAIN_TITLE_RE = /维护[\u4e00-\u9fff]{0,16}(?:主页|页面|界面|弹窗)|维护页(?!签)/g;
/** Closer-line residual: 「修改…后」+ closer is not a second maintain. */
const MAINTAIN_AFTER_CLOSER_RE = /修改[^【\n]{0,16}后/g;
const BRACKET_MAINTAIN_RE = /【[^】]*(?:维护|修改|编辑)[^】]*】/;
const BRACKET_ADD_RE = /【[^】]*添加[^】]*】/;
const CLICK_ADD_RE = /(?:点击|点)添加/;
const BRACKET_EXPORT_RE = /【[^】]*(?:导出|下载)[^】]*】/;
const CLICK_EXPORT_RE = /(?:点击|点)(?:【)?(?:导出|下载)/;

const PERSIST_AS_CAP_FAMILIES = new Set(['delete', 'status', 'clone']);
const PERSIST_AS_CAP_BRACKET_RE = /【[^】]*(?:启用|禁用|克隆|删除|作废|撤销)[^】]*】/;
const PERSIST_AS_CAP_BARE_RE = /(?<![未已])启用(?![\u4e00-\u9fff]{0,8}状态)|禁用(?!理由|页|[\u4e00-\u9fff]{0,8}状态)|克隆(?!页)|删除(?!理由)|作废|撤销(?!查询)/;
const CLOSER_RE = /确定|保存(?!概况)|提交/;
const CREATE_OPENER_MARK_RE = /【[^】]*(?:新增|添加|创建|新建)[^】]*】/;
const CREATE_WORD_RE = /新增|添加|创建|新建/;
const STEP_DUNHAO_RE = /^\s*\d+、/;
const STEP_DOT_RE = /^\s*\d+[\.．]\s+/;

/**
 * True when haystack names a persist-as-capability action rather than a
 * noun modifier (启用状态 / 启用和禁用状态 / 禁用理由 / 克隆页).
 * @param {string} haystack Group action text
 * @returns {boolean} Persist-as-capability verb present
 */
function hasPersistAsCapVerb(haystack) {
  const src = String(haystack || '');
  return PERSIST_AS_CAP_BRACKET_RE.test(src) || PERSIST_AS_CAP_BARE_RE.test(src);
}

/**
 * Clicking 【新增…】 (or opening a create page) without a closer is locate-prep,
 * not a second create capability beside the later fill+save.
 * @param {string} haystack Group action text
 * @returns {boolean} Create-opener prep
 */
function isCreateOpenerPrep(haystack) {
  const src = String(haystack || '');
  if (CLOSER_RE.test(src)) return false;
  if (CREATE_OPENER_MARK_RE.test(src)) return true;
  if ((src.includes('打开') || src.includes('进入')) && CREATE_WORD_RE.test(src)) return true;
  return false;
}

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
 * Haystack is the full step-group body (step prose + 操作 block).
 * Strips a leading numbering prefix and the `操作：`/`操作:` marker, but
 * does not drop the description before the marker. Metadata is already
 * removed by parse.
 * @param {string} raw Group text
 * @returns {string} Classification haystack
 */
function extractHaystack(raw) {
  let src = String(raw || '');
  src = src.replace(STEP_DUNHAO_RE, '').replace(STEP_DOT_RE, '');
  return src.replace(/操作[:：]/g, '');
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
 * Maintain `编辑` matches only when not immediately followed by `主页`/`页`/`界面`/`页面`.
 * Maintain `维护` skips page/dialog titles (`维护…主页|页面|界面|弹窗`).
 * `填写`/`录入` are not maintain (fill-in within create/edit).
 * Closer lines ignore residual `修改…后` unless a bracketed 修改/编辑/维护 mark is present.
 * Create `新增` matches only when not a page-title compound (`新增…主页/页面/界面/页`)
 * and not a closer-less 【新增…】 / open-create opener (locate-prep).
 * Create `添加` prefers 【添加】 / 点击添加; noun phrases like `需要添加的` do not count.
 * Export prefers 【导出】/【下载】 or 点击导出; bare restatement does not count.
 * Status/clone/delete skip noun modifiers (启用状态 / 启用和禁用状态 / 禁用理由 / 克隆页).
 * @param {string} haystack Group action text
 * @returns {Set<string>} Family ids
 */
function detectOtherFamilies(haystack) {
  /** @type {Set<string>} */
  const found = new Set();
  for (const [id, words] of Object.entries(OTHER_FAMILIES)) {
    if (id === 'status') {
      if (/【[^】]*(?:启用|禁用)[^】]*】/.test(haystack)
        || /(?<![未已])启用(?![\u4e00-\u9fff]{0,8}状态)/.test(haystack)
        || /禁用(?!理由|页|[\u4e00-\u9fff]{0,8}状态)/.test(haystack)) {
        found.add('status');
      }
      continue;
    }
    if (id === 'clone') {
      if (/【[^】]*克隆[^】]*】/.test(haystack) || /克隆(?!页)/.test(haystack) || haystack.includes('复制')) {
        found.add('clone');
      }
      continue;
    }
    if (id === 'delete') {
      if (/【[^】]*删除[^】]*】/.test(haystack) || /删除(?!理由)/.test(haystack) || haystack.includes('移除')) {
        found.add('delete');
      }
      continue;
    }
    if (id === 'create') {
      if (isCreateOpenerPrep(haystack)) continue;
      if (words.some((w) => {
        if (w === '新增') {
          return /新增(?![\u4e00-\u9fff]{0,16}(?:主页|页面|界面|页))/.test(haystack);
        }
        if (w === '添加') {
          return BRACKET_ADD_RE.test(haystack) || CLICK_ADD_RE.test(haystack);
        }
        return haystack.includes(w);
      })) {
        found.add(id);
      }
      continue;
    }
    if (id === 'maintain') {
      let src = haystack.replace(MAINTAIN_TITLE_RE, '');
      if (CLOSER_RE.test(haystack) && !BRACKET_MAINTAIN_RE.test(haystack)) {
        src = src.replace(MAINTAIN_AFTER_CLOSER_RE, '');
      }
      if (words.some((w) => (w === '编辑' ? /编辑(?!主页|页|界面|页面)/.test(src) : src.includes(w)))) {
        found.add(id);
      }
      continue;
    }
    if (id === 'export') {
      if (BRACKET_EXPORT_RE.test(haystack) || CLICK_EXPORT_RE.test(haystack)) {
        found.add('export');
      }
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
  return hasPersistAsCapVerb(haystack);
}

/**
 * True when haystack is a closer tail: 确定/保存/提交. Persist-as-capability
 * families (status/clone/delete) in the same closer line are allowed so
 * 「点击【确定】完成克隆」 stays one closer. Residual `修改…后` and fill-in
 * 填写/录入 are not maintain, so 「修改信息后点击【保存】」 is closer-only.
 * Bracketed 维护/修改/编辑 still block.
 * @param {string} haystack Group action text
 * @returns {boolean} Closer-only persist
 */
function isCloserOnlyPersistHaystack(haystack) {
  const src = String(haystack || '');
  if (!CLOSER_RE.test(src)) return false;
  for (const family of detectOtherFamilies(src)) {
    if (!PERSIST_AS_CAP_FAMILIES.has(family)) return false;
  }
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
  while (i < roles.length && (roles[i] === 'locate' || roles[i] === 'neutral')) i += 1;
  if (i < roles.length && roles[i] === 'persist' && isCloserOnlyPersistHaystack(groups[i].haystack)) {
    // Closer tail after other / persist-as-cap / persist main. Extra confirms
    // are owned by multi_persist_task_draft, not this gate.
    if (roles[mainIdx] === 'other' || mainIsPersistCap || roles[mainIdx] === 'persist') i += 1;
    else return { ok: false, reason: 'multi_capability_task_draft' };
  }
  for (; i < roles.length; i += 1) {
    if (roles[i] === 'locate' || roles[i] === 'neutral') continue;
    return { ok: false, reason: 'multi_capability_task_draft' };
  }
  return { ok: true };
}

/**
 * Deterministic fallback produce key that is never the raw title (spec §4.4).
 * @param {unknown} title Atom title
 * @returns {string} Non-empty key, !== trimmed title when title is non-empty
 */
export function synthesizeFallbackProduceKey(title) {
  const key = String(title || '').trim();
  if (!key) return 'atom_output';
  const synthesized = `${key}产物`;
  return synthesized === key ? `${key}_output` : synthesized;
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
  const produces = Array.isArray(atom?.produces) ? atom.produces : [];
  const title = String(atom?.title ?? '').trim();
  if (produces.length === 1 && produces[0] === title) {
    return { ok: false, reason: 'produces_eq_title' };
  }
  return { ok: true };
}
