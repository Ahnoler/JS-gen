/**
 * Requirement-text extraction helpers for trajectories: business-data block
 * extraction, KV entry parsing, business-data phase gating.
 * Extracted from trajectory-meta-service.js — move-only, no logic changes.
 */
import * as businessDataDao from '../../dao/business-data-dao.js';

/** Section headers that introduce a business-data block in a requirement. */
export const BUSINESS_DATA_SECTION_RE = /^(业务数据|案例数据|关键数据|测试数据|预设数据|用例数据)\s*[:：]?$/i;
const BUSINESS_DATA_HEADER_INLINE_RE = /^(业务数据|案例数据|关键数据|测试数据|预设数据|用例数据)\s*[:：]/i;

/** Trailing AI value-hint blocks — must not drive phase-type classification. */
const BUSINESS_DATA_MARK_RE = /\n*【(?:业务数据|业务场景案例数据|预设案例数据)[^\n]*】[\s\S]*$/;

/**
 * Strip trailing 【业务数据】/ legacy case-data blocks from phase text.
 * @param {string} text phase goal text
 * @returns {string} phase text with trailing business-data block removed
 */
export function stripBusinessDataBlock(text) {
  return String(text || '').replace(BUSINESS_DATA_MARK_RE, '').trim();
}

/**
 * Whether this phase goal should receive 业务数据 for the AI.
 * Fill / modify / introduce / **query(search)** — search keywords & locate
 * targets live in 关键数据 (#676). Not login (unless credential co-occurrence)
 * or pure open-page navigate.
 * @param {string} phaseText phase goal text
 * @returns {boolean} true when the phase should receive business-data injection
 */
export function phaseNeedsBusinessData(phaseText) {
  const t = stripBusinessDataBlock(phaseText);
  if (!t) return false;

  // Phase text explicitly referencing 业务数据 credential keys wins over the
  // login/query gates (auth-recording login task says「账号/密码…业务数据通道
  // 注入」). Narrow co-occurrence so ordinary prose that merely mentions
  // 业务数据 doesn't flip fill/query/navigate phases.
  if (/业务数据/.test(t) && /账号|密码|username|password/i.test(t)) return true;

  const isLogin = /登录|登入/i.test(t)
    && !/新增|创建|录入|填写|修改|编辑|引入|校验/.test(t);
  if (isLogin) return false;

  const openPage = /预期结果[:：]?[^。；\n]{0,12}(?:打开|进入|抵达|到达)[^。；\n]{0,20}(?:页面|界面|弹窗|对话框)/.test(t);
  const beforeExpect = (t.split(/预期结果/)[0] || t);
  const actionHasWrite = /新增|创建|录入|填写|新建|添加|校验|开立|修改|编辑|更新|维护|引入|选人|选择客户|保存|提交/.test(beforeExpect);
  if (openPage && !actionHasWrite) return false;

  // #676: query/search/locate phases need 业务数据 (keywords / target names)
  if (/查询|搜索|查找|选中|定位/.test(t)) return true;

  if (/新增|创建|录入|填写|新建|添加|校验|开立|修改|编辑|更新|变更|维护/.test(t)) return true;
  if (/引入|选人|客户选择|选择客户|选择.*客户/.test(t)) return true;
  return false;
}

/**
 * Extract the raw「关键数据 / 业务数据 …」block from a *user requirement*.
 *
 * Semantically this is **业务数据** (what the user wants to use), not
 * **system_ref** (target-system captured / verified) and not legacy business_data
 * as the product home for system references. Section headers in NL often still
 * say「关键数据」or「业务数据」— treat the block as 业务数据.
 * Never persist this block into system_ref_*.
 *
 * Primary contract for AI fill: soft, relatively-structured notes; tolerate
 * wording drift; do not require colon-separated label=value.
 * @param {string} text user requirement text
 * @returns {string} block including header, or '' if none
 */
export function extractBusinessDataBlock(text) {
  const lines = String(text || '').split(/\r?\n/);
  const collected = [];
  let inBlock = false;

  for (const line of lines) {
    const t = line.trim();
    if (!inBlock) {
      if (BUSINESS_DATA_SECTION_RE.test(t) || BUSINESS_DATA_HEADER_INLINE_RE.test(t)) {
        inBlock = true;
        collected.push(line);
      }
      continue;
    }
    // Next numbered step ends the business-data block
    if (/^\d+[\.、\)]\s*/.test(t)) break;
    collected.push(line);
  }

  return collected.join('\n').trim();
}

/**
 * Best-effort KV parse of requirement 业务数据 (user wish-list text).
 * Secondary to {@link extractBusinessDataBlock}. Do not confuse with 业务数据
 * persisted from the system. Incomplete / fuzzy user wording is normal —
 * empty parse ≠ "no 业务数据"; the raw block still goes to the agent.
 * @param {string} text user requirement text
 * @returns {Array<{ fieldKey: string, fieldValue: string }>} normalized KV entries (may be empty)
 * @deprecated Prefer extractBusinessDataBlock for AI fill context.
 */
export function extractBusinessEntriesFromRequirement(text) {
  const lines = String(text || '').split(/\r?\n/);
  const raw = [];
  let inBlock = false;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    if (BUSINESS_DATA_SECTION_RE.test(t)) {
      inBlock = true;
      continue;
    }

    const headerInline = t.match(/^(业务数据|案例数据|关键数据|测试数据|预设数据|用例数据)\s*[:：]\s*(.+)$/i);
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
      // 无冒号/等号分隔的「引入」类业务数据：
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

  return businessDataDao.normalizeBusinessEntries(raw);
}

/**
 * Extract the global hard-success-gate block (【硬性成功门闩/门槛——…】) from a
 * requirement text. The block starts at the gate header line and ends before the
 * first numbered step or a business-data section header. Empty when absent —
 * users who skip writing gates simply get no injection downstream.
 * @param {string} text requirement original text (trajectory.task)
 * @returns {string} gate block text (header + bullets), '' when not present
 */
export function extractSuccessGatesBlock(text) {
  const m = String(text || '').match(
    // 门闩块 = 头行 + 若干「-」条目行；遇编号步骤行即止（编号属于操作步骤）
    /^[ \t]*【?\s*硬性成功门[槛闩][^\n]*】?[^\n]*\n(?:[ \t]*[-*•][^\n]*\n?)*/m,
  );
  if (!m) return '';
  const block = m[0].trim();
  // 至少要有头行之外的一行内容才算有效块，避免只截到孤零零的标题
  return block.includes('\n') ? block : '';
}
