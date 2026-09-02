/**
 * 录制准备阶段——起点页面 ID 绑定。
 *
 * 在 record/prepare 登录成功后，按交易所属功能的 menu_xpath 自动导航到功能页，
 * 发 replay 动作 `read_page_component_code` 读取起点页面「天元相关配置」的组件/场景编号，
 * 取值优先级：实测组件编号 > 场景编号 > AILZ+13位时间戳生成；最后 `trajectoryDao.updateMeta` 落库。
 * 菜单回写（pd_cmpt_ecd + system_page）仅当落地来自弹窗（source=read）且功能节点 source 为 json_import 或 ai。
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
 * 将天元实测组件编号回写为功能节点唯一落地 pageId（pd_cmpt_ecd + system_page 整替一行）。
 * 失败只 warn，不抛——不得阻断录制启动。
 * @param {number} functionId 功能节点 id
 * @param {{ pageId: string, pageName?: string, resPath?: string }} landing 落地页
 * @returns {Promise<void>}
 */
async function writeBackFunctionLandingPage(functionId, landing) {
  const pageId = String(landing?.pageId || '').trim();
  if (!pageId) return;
  const fid = Number(functionId);
  if (!Number.isFinite(fid) || fid <= 0) return;
  try {
    await systemDao.update(fid, { pdCmptEcd: pageId });
    await systemPageDao.replaceForNode(fid, [{
      pageId,
      pageName: String(landing.pageName || '').trim(),
      resPath: String(landing.resPath || '').trim(),
      pageType: 'managePage',
    }]);
    console.log('[page-bind] wrote back function#%s landing pageId=%s', fid, pageId);
  } catch (err) {
    console.warn('[page-bind] write-back landing failed function#%s: %s', fid, err?.message || err);
  }
}

/**
 * 录制准备阶段绑定起点页面 ID：导航到功能菜单 → 读组件编号（读不到 AILZ 兜底）→ 落库。
 *
 * 流程：
 * 1. `Number(functionId)` 无效 → 直接走 AILZ 兜底路径（跳过导航/读页）
 * 2. `navigateToFunctionMenu`（失败仅 log，继续——导航失败时读的是当前页，读不到就 AILZ）
 * 3. 发 `read_page_component_code` replay 动作，从 `r.results` 取 `row.pageCode`
 * 4. `pageId = componentCode || scenarioCode || generatePageId()`
 * 5. 与功能节点 system_page 已知页面 ID 交叉校验（仅 console.log，不阻断）
 * 6. `source=read` 且功能节点 `source∈{json_import,ai}` 时回写功能落地 pageId
 * 7. `trajectoryDao.updateMeta(tid, { pageId })` 落库
 *
 * 全程 try/catch 最外层：任何异常 `console.warn('[page-bind] ...')` 后 return，绝不 throw。
 * @param {object} opts 参数对象
 * @param {object} opts.runtime 轨迹运行时（sessionId/executorNodeUuid）
 * @param {number} opts.tid trajectory DB id
 * @param {number} opts.functionId 交易所属功能节点 id
 * @param {object} opts.execSession executor 会话客户端（waitForSessionEvent/forwardStdin）
 * @returns {Promise<{ pageId: string, source: 'read'|'generated', persisted: boolean, reused?: boolean }>} 绑定结果（内部用；persisted=落库是否成功）
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
      let persisted = true;
      try {
        await trajectoryDao.updateMeta(Number(tid), { pageId });
      } catch (persistErr) {
        persisted = false;
        console.warn('[page-bind] PERSIST-FAILED trajectory#%s pageId=%s: %s', tid, pageId, persistErr?.message || persistErr);
      }
      console.log('[page-bind] trajectory#%s pageId=%s persisted=%s', tid, pageId, persisted);
      return { pageId, source, persisted };
    }

    // 步骤 2：按菜单导航（失败仅 log，继续）
    try {
      const nav = await navigateToFunctionMenu({ runtime, functionId: fid, execSession });
      if (!nav?.navigated) {
        console.log('[page-bind] menu navigation skipped: %s', nav?.reason || 'unknown');
      }
      // 步骤 2.5：同菜单复用守卫——导航因 same-menu 跳过且本 runtime 已成功落库过 pageId 时，
      // 跳过重复 read（页面未变则组件编号不变；避免每次 prepare 重开天元弹窗拖慢且打扰）
      if (!nav?.navigated && nav?.reason === 'same-menu' && runtime._pageBoundId) {
        const cachedId = String(runtime._pageBoundId);
        console.log('[page-bind] reuse cached pageId=%s (same menu, skip re-read)', cachedId);
        return { pageId: cachedId, source: 'read', persisted: true, reused: true };
      }
    } catch (navErr) {
      console.warn('[page-bind] menu navigation failed: %s', navErr?.message || navErr);
    }

    // 步骤 3：读组件/场景编号
    let componentCode = '';
    let scenarioCode = '';
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
      // Python 侧把整个 payload 挂在 row.pageCode：{ componentCode, scenarioCode, pageName, pagePath, activityName, reason }
      const payload = row?.pageCode && typeof row.pageCode === 'object' ? row.pageCode : {};
      if (row) {
        componentCode = String(payload.componentCode || '').trim();
        scenarioCode = String(payload.scenarioCode || '').trim();
        pageName = String(payload.pageName || '').trim();
        pagePath = String(payload.pagePath || '').trim();
      }
    } catch (readErr) {
      console.warn('[page-bind] read_page_component_code failed: %s', readErr?.message || readErr);
    }

    // 步骤 4：取值优先级 实测组件编号 > 场景编号 > AILZ 兜底
    pageId = String(componentCode || scenarioCode || '').trim();
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

    if (source === 'read' && pageId) {
      try {
        const fnNode = await systemDao.getById(fid);
        const menuSource = String(fnNode?.source || '').trim();
        if (menuSource === 'json_import' || menuSource === 'ai') {
          await writeBackFunctionLandingPage(fid, {
            pageId,
            pageName,
            resPath: pagePath,
          });
        } else {
          console.log('[page-bind] skip menu write-back: function#%s source=%s', fid, menuSource || '(empty)');
        }
      } catch (wbErr) {
        console.warn('[page-bind] write-back gate failed function#%s: %s', fid, wbErr?.message || wbErr);
      }
    }

    // 步骤 6：落库——失败不再静默：pageId 停留旧值会破坏执行期导航，warn 带 PERSIST-FAILED 标志并标注 persisted
    let persisted = true;
    try {
      await trajectoryDao.updateMeta(Number(tid), { pageId });
    } catch (persistErr) {
      persisted = false;
      console.warn('[page-bind] PERSIST-FAILED trajectory#%s pageId=%s: %s', tid, pageId, persistErr?.message || persistErr);
    }
    if (persisted) {
      runtime._pageBoundId = pageId;
    }
    console.log('[page-bind] trajectory#%s pageId=%s persisted=%s', tid, pageId, persisted);
    return { pageId, source, persisted };
  } catch (err) {
    console.warn('[page-bind] bind failed: %s', err?.message || err);
    return { pageId: '', source: 'generated' };
  }
}
