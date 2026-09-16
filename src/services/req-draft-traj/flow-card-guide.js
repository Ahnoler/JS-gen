/**
 * 用于在草稿轨迹提议期间选择流程卡并组织其引导信息的辅助函数。
 *
 * 本模块识别持久化边界，检查一组步骤是否可视为一个闭环，通过共享召回函数对
 * 相关卡片排序，并将卡片数据精简为提供给原子化 LLM 的紧凑结构。它不会修改
 * 卡片或持久化提议数据。
 */
import { matchFlowForAtom } from './flow-card-recall.js';

const PERSIST_BOUNDARY_RE = /保存|提交|(?<![未已])启用|禁用|克隆|删除|作废|撤销(?!查询)|确定/;
const CONFIRM_MARK_RE = /【确定】|确定】/;

/**
 * True when a step-shaped value has any action/buttons text.
 * @param {unknown} item Action string or `{ action, buttons }`
 * @returns {boolean} True when the step contributes persist haystack
 */
function hasStepText(item) {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return Boolean(String(item.action || '').trim() || String(item.buttons || '').trim());
  }
  return Boolean(String(item || '').trim());
}

/**
 * 判断操作是否为原子分组的持久化边界。
 *
 * 保存、提交、确认、状态变更和破坏性操作都会结束一个闭环分组。正则通过负向
 * 回顾排除「未启用/已启用」对「启用」的误匹配，并通过负向前瞻排除查询类撤销。
 * 步骤对象的 buttons 只把【确定】/确定计为边界，避免【保存概况】把填单步误当成二次保存。
 * @param {unknown} action 候选操作文本，或 `{ action?: unknown, buttons?: unknown }`
 * @returns {boolean} 操作结束持久化分组时为 true
 */
export function isPersistBoundaryAction(action) {
  if (action && typeof action === 'object' && !Array.isArray(action)) {
    if (PERSIST_BOUNDARY_RE.test(String(action.action || ''))) return true;
    return /确定/.test(String(action.buttons || ''));
  }
  return PERSIST_BOUNDARY_RE.test(String(action || ''));
}

/**
 * 检查一个序列是否至多包含一个持久化边界。
 *
 * 空或缺失输入会被拒绝。导航和准备操作可以伴随单个写入边界；多个边界则需要
 * 拆分为独立原子，以免一个原子代表多笔交易。步骤可带 buttons，以便【确定】
 * 计入边界。
 * @param {{ stepActions?: unknown[] }} opts 步骤操作集合（字符串或 `{ action, buttons }`）
 * @returns {boolean} 操作构成一个闭环时为 true
 */
export function stepsShareClosedLoop({ stepActions }) {
  const actions = (stepActions || []).filter((a) => hasStepText(a));
  if (actions.length === 0) return false;
  const boundaries = actions.filter((a) => isPersistBoundaryAction(a));
  return boundaries.length <= 1;
}

/**
 * Count persist confirms in taskDraft text (separate saves).
 *
 * Each `【确定】` / `确定】` counts once. Lines that are persist boundaries
 * without a confirm mark (保存/提交/启用/…) count as additional confirms so
 * a draft that lists two saves is rejected even if it never wrote 确定.
 * 「保存概况」 in a line is stripped first so a fill-step button does not
 * inflate the count next to a later 【保存】.
 * @param {unknown} text Task draft or other haystack
 * @returns {number} Number of persist confirms
 */
export function countPersistConfirms(text) {
  const src = String(text || '');
  const confirmHits = src.match(new RegExp(CONFIRM_MARK_RE.source, 'g')) || [];
  const otherLines = src.split(/\r?\n/).filter((line) => {
    if (CONFIRM_MARK_RE.test(line)) return false;
    const stripped = line.replaceAll('保存概况', '');
    return PERSIST_BOUNDARY_RE.test(stripped);
  });
  return confirmHits.length + otherLines.length;
}

/**
 * 将链路元数据和步骤字段扁平化为召回文本。
 * @param {Array<{ title?: string, chainId?: string, steps?: Array<{ action?: string, zjjk?: string, page?: string, buttons?: string }> }>} chains 已解析的链路
 * @returns {string} 用作召回查询的换行分隔文本
 */
function chainHaystack(chains) {
  const parts = [];
  for (const c of chains || []) {
    parts.push(c.title, c.chainId);
    for (const s of c.steps || []) {
      parts.push(s.action, s.zjjk, s.page, s.buttons);
    }
  }
  return parts.filter(Boolean).join('\n');
}

/**
 * 选择与已解析链路相关、得分最高且不重复的流程卡。
 *
 * 卡片通过共享匹配器独立评分，按分数再按 stem 排序，并在应用请求数量上限前去重。
 * @param {{ chains?: object[], cards?: object[], limit?: number }} opts 选择输入
 * @returns {object[]} 按确定性得分顺序排列的相关卡片
 */
export function selectRelevantFlowCards({ chains, cards, limit = 6 }) {
  const list = Array.isArray(cards) ? cards : [];
  const hay = chainHaystack(chains);
  /** @type {Array<{ card: object, score: number }>} */
  const scored = [];
  for (const card of list) {
    const hit = matchFlowForAtom({ title: hay, taskDraft: '', cards: [card] });
    const score = Number(hit.score) || 0;
    if (score > 0) scored.push({ card, score });
  }
  scored.sort((a, b) => b.score - a.score || String(a.card._stem).localeCompare(String(b.card._stem)));
  const out = [];
  const seen = new Set();
  for (const { card } of scored) {
    const stem = card._stem || card.flow;
    if (seen.has(stem)) continue;
    seen.add(stem);
    out.push(card);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 将流程卡投影为发送给原子化器的有界引导结构。
 *
 * 摘要保留卡片身份、菜单路径、六个前置条件和有用的节点字段。按钮和字段列表
 * 均设上限，以保持提示词大小稳定。
 * @param {object[]} cards 要汇总的流程卡
 * @returns {Array<object>} 面向 LLM 的卡片摘要
 */
export function summarizeCardsForLlm(cards) {
  return (cards || []).map((card) => ({
    flowRef: card._stem || null,
    flow: card.flow,
    menu_path: card.menu_path || '',
    preconditions: (card.preconditions || []).slice(0, 6),
    nodes: (card.nodes || []).map((n) => ({
      id: n.id,
      page: n.page,
      enter: n.enter,
      buttons: (n.buttons || []).slice(0, 12),
      fields: (n.fields || []).slice(0, 16),
    })),
  }));
}
