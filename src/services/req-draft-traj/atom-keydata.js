/**
 * 用于拟议草稿轨迹原子的关键数据规范化辅助函数。
 *
 * 页面/组件编码按稳定的首次出现顺序，从 LLM 输出、任务文本和来源表格单元格中
 * 收集。仅含 ZJJK 的元数据会从面向用户的关键数据章节中移除，但其编码仍保留为
 * 结构化数据。这些辅助函数均为纯函数，不写入文件。
 */
import { extractZjjkCodes } from './provenance.js';

const KEYDATA_HEADER_RE = /^(关键数据|业务数据|案例数据|测试数据|预设数据|用例数据)\s*[:：]?$/i;
/** Line is "only" page-code metadata if every token is ZJJK-ish or label noise. */
const PURE_ZJJK_META_RE = /^(?:大页面|页签|页面|组件|编号)?\s*[:：]?\s*(?:ZJJK\d{5,}(?:\s*[\/|,，]\s*ZJJK\d{5,})*)\s*$/i;

/**
 * 从全部原子编码来源收集唯一的 ZJJK 页面/组件编码。
 *
 * 值由共享出处提取器规范化，并按来源顺序仅输出一次：LLM pageCodes、taskDraft
 * 文本、再到通链单元格。无效或缺失的集合不贡献任何值。
 * @param {{ llmPageCodes?: unknown, taskDraft?: string, zjjkCells?: unknown[] }} opts 编码来源
 * @returns {string[]} 按顺序排列且转为大写的唯一 ZJJK 编码
 */
export function collectPageCodes({ llmPageCodes, taskDraft, zjjkCells } = {}) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  /**
   * 从单个来源值提取编码，并仅追加未出现过的编码。
   * @param {unknown} raw 可能包含 ZJJK 编码的来源值
   * @returns {void}
   */
  const pushAll = (raw) => {
    for (const code of extractZjjkCodes(String(raw || ''))) {
      if (seen.has(code)) continue;
      seen.add(code);
      out.push(code);
    }
  };
  if (Array.isArray(llmPageCodes)) {
    for (const item of llmPageCodes) pushAll(item);
  }
  pushAll(taskDraft);
  if (Array.isArray(zjjkCells)) {
    for (const cell of zjjkCells) pushAll(cell);
  }
  return out;
}

/**
 * 判断一行是否仅包含 ZJJK 元数据及可选标签。
 *
 * 匹配行可以使用已识别的元数据前缀，或仅由一个或多个以标点分隔的编码构成。
 * 空行和包含业务内容的行由清理器保留。
 * @param {string} line 候选关键数据行
 * @returns {boolean} 该行可作为编码元数据安全移除时为 true
 */
function isPureZjjkMetaLine(line) {
  const t = String(line || '').trim();
  if (!t) return false;
  if (PURE_ZJJK_META_RE.test(t)) return true;
  // bare code(s) only
  const codes = extractZjjkCodes(t);
  if (!codes.length) return false;
  const stripped = t.replace(/ZJJK\d{5,}/gi, '').replace(/[\s\/|,，:：\-—_]/g, '');
  return stripped.length === 0;
}

/**
 * Remove ZJJK-only lines from 关键数据; drop empty keydata section.
 *
 * 该章节在下一条编号任务/来源行处结束。保留非编码内容和有意义的空白；清空后的
 * 章节会被省略，非空输出会规范为以换行结尾。
 * @param {string} taskDraft 要清理的草稿任务文本
 * @returns {{ taskDraft: string, extractedCodes: string[] }} 清理后的文本和提取出的编码
 */
export function sanitizeTaskDraftKeyData(taskDraft) {
  const lines = String(taskDraft || '').split(/\r?\n/);
  /** @type {string[]} */
  const extractedCodes = [];
  /** @type {string[]} */
  const out = [];
  let inKey = false;
  /** @type {string[]} */
  const keyBuf = [];

  /**
   * 刷新缓冲的关键数据章节，并移除仅含编码的元数据行。
   * @returns {void}
   */
  const flushKey = () => {
    const kept = [];
    for (const raw of keyBuf) {
      const t = raw.trim();
      if (!t) {
        kept.push(raw);
        continue;
      }
      if (isPureZjjkMetaLine(t)) {
        for (const c of extractZjjkCodes(t)) {
          if (!extractedCodes.includes(c)) extractedCodes.push(c);
        }
        continue;
      }
      kept.push(raw);
    }
    while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
    const body = kept.filter((l) => l.trim());
    if (body.length === 0) return;
    out.push('关键数据');
    out.push(...kept);
  };

  for (const line of lines) {
    const t = line.trim();
    if (!inKey) {
      if (KEYDATA_HEADER_RE.test(t)) {
        inKey = true;
        keyBuf.length = 0;
        continue;
      }
      out.push(line);
      continue;
    }
    if (/^\d+[\.、\)]\s*/.test(t) || /^来源\s*[:：]/.test(t)) {
      flushKey();
      inKey = false;
      out.push(line);
      continue;
    }
    keyBuf.push(line);
  }
  if (inKey) flushKey();

  let text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text) text += '\n';
  return { taskDraft: text, extractedCodes };
}

/**
 * 检测关键数据正文仅包含 ZJJK 元数据的旧版结构。
 *
 * 检查在下一条编号任务行处停止，忽略空行；章节不存在或没有正文时返回 false。
 * @param {string} taskDraft 要检查的草稿任务文本
 * @returns {boolean} 关键数据正文是仅含编码的旧版内容时为 true
 */
export function isLegacyZjjkOnlyKeyData(taskDraft) {
  const lines = String(taskDraft || '').split(/\r?\n/);
  let inKey = false;
  /** @type {string[]} */
  const body = [];
  for (const line of lines) {
    const t = line.trim();
    if (!inKey) {
      if (KEYDATA_HEADER_RE.test(t)) inKey = true;
      continue;
    }
    if (/^\d+[\.、\)]\s*/.test(t)) break;
    if (!t) continue;
    body.push(t);
  }
  if (body.length === 0) return false;
  return body.every((l) => isPureZjjkMetaLine(l));
}
