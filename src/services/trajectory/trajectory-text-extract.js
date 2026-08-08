/**
 * Requirement-text extraction helpers for trajectories: case-data block
 * extraction, KV entry parsing, business-data phase gating.
 * Extracted from trajectory-meta-service.js — move-only, no logic changes.
 */
import * as caseDataDao from '../../dao/case-data-dao.js';

/** Section headers that introduce a case-data block in a requirement. */
export const CASE_DATA_SECTION_RE = /^(案例数据|关键数据|测试数据|预设数据|用例数据)\s*[:：]?$/i;
const CASE_DATA_HEADER_INLINE_RE = /^(案例数据|关键数据|测试数据|预设数据|用例数据)\s*[:：]/i;

/** Trailing AI value-hint blocks — must not drive phase-type classification. */
const BUSINESS_DATA_MARK_RE = /\n*【(?:业务数据|业务场景案例数据|预设案例数据)[^\n]*】[\s\S]*$/;

/**
 * Strip trailing 【业务数据】/ legacy case-data blocks from phase text.
 * @param {string} text
 * @returns {string}
 */
export function stripBusinessDataBlock(text) {
  return String(text || '').replace(BUSINESS_DATA_MARK_RE, '').trim();
}

/**
 * Whether this phase goal should receive 业务数据 for the AI.
 * Fill / modify / introduce only — not login, pure open-page navigate, or list query.
 * @param {string} phaseText
 * @returns {boolean}
 */
export function phaseNeedsBusinessData(phaseText) {
  const t = stripBusinessDataBlock(phaseText);
  if (!t) return false;

  const isLogin = /登录|登入/i.test(t)
    && !/新增|创建|录入|填写|修改|编辑|引入|校验/.test(t);
  if (isLogin) return false;

  const openPage = /预期结果[:：]?[^。；\n]{0,12}(?:打开|进入|抵达|到达)[^。；\n]{0,20}(?:页面|界面|弹窗|对话框)/.test(t);
  const beforeExpect = (t.split(/预期结果/)[0] || t);
  const actionHasWrite = /新增|创建|录入|填写|新建|添加|校验|开立|修改|编辑|更新|维护|引入|选人|选择客户|保存|提交/.test(beforeExpect);
  if (openPage && !actionHasWrite) return false;

  const isQuery = /查询|搜索|查找/.test(t)
    && !/新增|创建|录入|填写|修改|编辑|引入|保存|提交|校验/.test(t);
  if (isQuery) return false;

  if (/新增|创建|录入|填写|新建|添加|校验|开立|修改|编辑|更新|变更|维护/.test(t)) return true;
  if (/引入|选人|客户选择|选择客户|选择.*客户/.test(t)) return true;
  return false;
}

/**
 * Extract the raw「关键数据 / 案例数据 …」block from a *user requirement*.
 *
 * Semantically this is **业务数据** (what the user wants to use), not
 * **system_ref** (target-system captured / verified) and not legacy case_data
 * as the product home for system references. Section headers in NL often still
 * say「关键数据」or「案例数据」— treat the block as 业务数据.
 * Never persist this block into system_ref_*.
 *
 * Primary contract for AI fill: soft, relatively-structured notes; tolerate
 * wording drift; do not require colon-separated label=value.
 * @param {string} text
 * @returns {string} block including header, or '' if none
 */
export function extractCaseDataBlock(text) {
  const lines = String(text || '').split(/\r?\n/);
  const collected = [];
  let inBlock = false;

  for (const line of lines) {
    const t = line.trim();
    if (!inBlock) {
      if (CASE_DATA_SECTION_RE.test(t) || CASE_DATA_HEADER_INLINE_RE.test(t)) {
        inBlock = true;
        collected.push(line);
      }
      continue;
    }
    // Next numbered step ends the case-data block
    if (/^\d+[\.、\)]\s*/.test(t)) break;
    collected.push(line);
  }

  return collected.join('\n').trim();
}

/**
 * Best-effort KV parse of requirement **业务数据** (user wish-list text).
 *
 * Secondary to {@link extractCaseDataBlock}. Do not confuse with 案例数据
 * persisted from the system. Incomplete / fuzzy user wording is normal —
 * empty parse ≠ “no 业务数据”; the raw block still goes to the agent.
 *
 * @deprecated Prefer extractCaseDataBlock for AI fill context.
 */
export function extractCaseEntriesFromRequirement(text) {
  const lines = String(text || '').split(/\r?\n/);
  const raw = [];
  let inBlock = false;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    if (CASE_DATA_SECTION_RE.test(t)) {
      inBlock = true;
      continue;
    }

    const headerInline = t.match(/^(案例数据|关键数据|测试数据|预设数据|用例数据)\s*[:：]\s*(.+)$/i);
    if (headerInline) {
      inBlock = true;
      const rest = headerInline[2].trim();
      const m = rest.match(/^(.+?)\s*[:：=]\s*(.+)$/);
      if (m) raw.push({ fieldKey: m[1], fieldValue: m[2] });
      continue;
    }

    if (inBlock && /^\d+[\.、\)]\s*/.test(t)) {
      inBlock = false;
    }
    if (!inBlock) continue;

    const m = t.match(/^(.+?)\s*[:：=]\s*(.+)$/);
    if (!m) {
      // 无冒号/等号分隔的「引入」类案例数据：
      // 「法定责任人引入 朱桂武」→ {fieldKey: 法定责任人引入, fieldValue: 朱桂武}
      // （AI 录制实锤：introduce 放大镜场景模型因解析不出 KV 而用主表单值查询）
      const intro = t.match(/^(.*?引入)\s+(\S.*)$/);
      if (intro) {
        const fk = intro[1].trim();
        const fv = intro[2].trim();
        if (fk && fv) raw.push({ fieldKey: fk, fieldValue: fv });
      }
      continue;
    }
    const fieldKey = m[1].trim();
    const fieldValue = m[2].trim();
    if (!fieldKey || !fieldValue) continue;
    if (/^(预期结果|步骤|阶段)$/.test(fieldKey)) continue;
    raw.push({ fieldKey, fieldValue });
  }

  return caseDataDao.normalizeCaseEntries(raw);
}

/**
 * Append 业务数据 block only to fill / introduce phases (not navigate / login / query).
 * @param {string[]} phases
 * @param {string} caseBlock
 */
export function appendCaseDataToPhases(phases, caseBlock) {
  const block = String(caseBlock || '').trim();
  if (!block || !Array.isArray(phases) || !phases.length) return phases || [];
  // Avoid「填写」in the mark — that keyword pollutes task_mode if strip ever fails.
  const suffix = `\n\n【业务数据 — 来自用户需求（非系统回写案例数据）；填表/引入时参考理解，按场景选用关键取值】\n${block}`;
  return phases.map((p) => {
    const text = String(p || '').trim();
    if (!text) return text;
    if (!phaseNeedsBusinessData(text)) return text;
    if (
      text.includes('【业务数据')
      || text.includes('【业务场景案例数据')
      || text.includes(block.slice(0, Math.min(40, block.length)))
    ) {
      return text;
    }
    return text + suffix;
  });
}
