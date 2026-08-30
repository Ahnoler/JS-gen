/**
 * 录制准备阶段——起点页面 ID 绑定。
 *
 * 在 record/prepare 登录成功后，按交易所属功能的 menu_xpath 自动导航到功能页，
 * 发 replay 动作 `read_page_component_code` 读取起点页面「天元相关配置」的组件编号，
 * 取值优先级：实测组件编号 > AILZ+13位时间戳生成；最后 `trajectoryDao.updateMeta` 落库。
 *
 * 整段绝不阻断录制启动：任何异常吞掉打 warn 后 return（绝不 throw）。
 * execSession 由调用方传入（便于测试），不在此处 import。
 */
import * as systemDao from '../../dao/system-dao.js';
import * as systemPageDao from '../../dao/system-page-dao.js';
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import { runReplayActions } from '../replay-actions.js';
import { navigateToFunctionMenu } from './menu-navigation.js';

/** 读组件编号 replay 超时（ms）。 */
const READ_PAGE_CODE_TIMEOUT_MS = 90000;

/**
 * 生成兜底起点页面 ID：`AILZ` + 13 位毫秒时间戳（Date.now()）。
 * @returns {string} 形如 `AILZ1769000000000` 的页面 ID
 */
export function generatePageId() {
  return `AILZ${String(Date.now())}`;
}

/**
 * 录制准备阶段绑定起点页面 ID：导航到功能菜单 → 读组件编号（读不到 AILZ 兜底）→ 落库。
 *
 * 流程：
 * 1. `Number(functionId)` 无效 → 直接走 AILZ 兜底路径（跳过导航/读页）
 * 2. `navigateToFunctionMenu`（失败仅 log，继续——导航失败时读的是当前页，读不到就 AILZ）
 * 3. 发 `read_page_component_code` replay 动作，从 `r.results` 取 `row.pageCode`
 * 4. `pageId = componentCode || generatePageId()`
 * 5. 与功能节点 system_page 已知页面 ID 交叉校验（仅 console.log，不阻断）
 * 6. `trajectoryDao.updateMeta(tid, { pageId })` 落库
 *
 * 全程 try/catch 最外层：任何异常 `console.warn('[page-bind] ...')` 后 return，绝不 throw。
 * @param {object} opts 参数对象
 * @param {object} opts.runtime 轨迹运行时（sessionId/executorNodeUuid）
 * @param {number} opts.tid trajectory DB id
 * @param {number} opts.functionId 交易所属功能节点 id
 * @param {object} opts.execSession executor 会话客户端（waitForSessionEvent/forwardStdin）
 * @returns {Promise<{ pageId: string, source: 'read'|'generated' }>} 绑定结果（内部用）
 */
export async function bindRecordingPageId({ runtime, tid, functionId, execSession } = {}) {
  try {
    const fid = Number(functionId);
    let pageId = '';
    let source = 'generated';

    // 步骤 1：functionId 无效 → 直接 AILZ 兜底
    if (!Number.isFinite(fid) || fid <= 0) {
      pageId = generatePageId();
      console.log('[page-bind] no functionId, generated pageId=%s', pageId);
      await trajectoryDao.updateMeta(Number(tid), { pageId });
      console.log('[page-bind] trajectory#%s pageId=%s', tid, pageId);
      return { pageId, source };
    }

    // 步骤 2：按菜单导航（失败仅 log，继续）
    try {
      const nav = await navigateToFunctionMenu({ runtime, functionId: fid, execSession });
      if (!nav?.navigated) {
        console.log('[page-bind] menu navigation skipped: %s', nav?.reason || 'unknown');
      }
    } catch (navErr) {
      console.warn('[page-bind] menu navigation failed: %s', navErr?.message || navErr);
    }

    // 步骤 3：读组件编号
    let componentCode = '';
    let pageName = '';
    let pagePath = '';
    try {
      const { result: r } = await runReplayActions({
        execSession,
        sessionId: runtime.sessionId,
        nodeUuid: runtime.executorNodeUuid,
        actions: [{ action: 'read_page_component_code', params: {} }],
        timeoutMs: READ_PAGE_CODE_TIMEOUT_MS,
        stopOnFail: false,
        isReplay: true,
      });
      const results = Array.isArray(r?.results) ? r.results : [];
      const row = results.find((it) => it && it.action === 'read_page_component_code');
      // Python 侧把整个 payload 挂在 row.pageCode：{ componentCode, pageName, pagePath, activityName, reason }
      const payload = row?.pageCode && typeof row.pageCode === 'object' ? row.pageCode : {};
      if (row) {
        componentCode = String(payload.componentCode || '').trim();
        pageName = String(payload.pageName || '').trim();
        pagePath = String(payload.pagePath || '').trim();
      }
    } catch (readErr) {
      console.warn('[page-bind] read_page_component_code failed: %s', readErr?.message || readErr);
    }

    // 步骤 4：取值优先级 实测组件编号 > AILZ 兜底
    pageId = String(componentCode || '').trim();
    if (!pageId) {
      pageId = generatePageId();
      source = 'generated';
    } else {
      source = 'read';
    }

    // 步骤 5：交叉校验（仅 console.log，不阻断）
    try {
      const pages = await systemPageDao.listByNodeId(fid);
      const knownIds = new Set((Array.isArray(pages) ? pages : []).map((p) => String(p.pageId || '')));
      if (source === 'read' && knownIds.has(pageId)) {
        console.log('[page-bind] pageId matches known page (pageName=%s pagePath=%s)', pageName, pagePath);
      } else if (source === 'read') {
        console.log('[page-bind] pageId not in system_page (menu-JSON 匹配外的真实编号): %s', pageId);
      } else {
        console.log('[page-bind] generated pageId (read failed): %s', pageId);
      }
    } catch (crossErr) {
      console.warn('[page-bind] cross-check with system_page failed: %s', crossErr?.message || crossErr);
    }

    // 步骤 6：落库
    await trajectoryDao.updateMeta(Number(tid), { pageId });
    console.log('[page-bind] trajectory#%s pageId=%s', tid, pageId);
    return { pageId, source };
  } catch (err) {
    console.warn('[page-bind] bind failed: %s', err?.message || err);
    return { pageId: '', source: 'generated' };
  }
}
