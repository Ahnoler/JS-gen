/**
 * 交易执行前的菜单导航——按交易所属功能的菜单 xpath 自动导航到功能页。
 *
 * 设计要点：
 * - 连续交易同菜单跳过（靠 runtime._lastMenuNavKey 去重）
 * - 空菜单直接返回（不导航）
 * - 导航失败不阻断交易执行（吞异常 + console.warn 后继续）
 * - 导航动作 is_replay 恒为 true（不入步骤表）
 */
import * as execSession from '../../executor-session-client.js';
import * as systemDao from '../../dao/system-dao.js';

/** 菜单导航单步超时（ms）——菜单点击通常很快，给 120s 余量。 */
const MENU_NAV_TIMEOUT_MS = 120000;

/**
 * 纯函数：根据模块/功能菜单 xpath 构建导航动作序列。
 *
 * 动作条目格式参照 _replay.py 的 click_element_by_index 分支
 * （replay_click.py _replay_click_by_index 消费 entry.element.xpath_smart /
 * xpath_full；params.text/tag_name 用于文本兜底定位）。
 * 顺序：先模块（展开 submenu）后功能。
 * @param {{ moduleXpath?: string, functionXpath?: string }} menuXpaths 模块与功能菜单 xpath
 * @returns {Array<object>} replay 动作条目数组（空数组=无需导航）
 */
export function buildMenuNavActions({ moduleXpath, functionXpath } = {}) {
  const actions = [];
  const moduleXp = String(moduleXpath || '').trim();
  const funcXp = String(functionXpath || '').trim();
  if (!moduleXp && !funcXp) return actions;
  // click_menu_xpath：JS 内轮询等菜单渲染后 DOM click（登录后菜单可能尚未渲染；
  // flyout 隐藏时常规回放点击会 not-found，DOM click 已实测可用）
  if (moduleXp) {
    actions.push({ action: 'click_menu_xpath', params: { xpath: moduleXp } });
  }
  if (funcXp) {
    actions.push({ action: 'click_menu_xpath', params: { xpath: funcXp } });
  }
  return actions;
}

/**
 * 交易执行前按菜单导航（同菜单跳过、空菜单直接返回、失败不抛出）。
 *
 * 流程：
 * 1. functionId 无效 → { navigated:false, reason:'no-function' }
 * 2. systemDao.getRawById(functionId) → 功能节点；parentId → 模块节点
 * 3. functionXpath = 功能节点.menuXpath，moduleXpath = 模块节点.menuXpath；都空 → {false,'no-menu-xpath'}
 * 4. 同菜单跳过：key = `${moduleXpath||''}|${functionXpath||''}`；与 runtime._lastMenuNavKey 相同 → {false,'same-menu'}
 * 5. actions = buildMenuNavActions(...)；waitForSessionEvent + forwardStdin（参照 runDefaultLogin 写法）
 * 6. replay_done 后 failed>0 或抛异常 → 吞掉并 console.warn，返回 {false,'nav-failed'}（不阻断）
 * 7. 成功 → runtime._lastMenuNavKey = key; return {true,'ok'}
 * @param {object} opts 参数对象
 * @param {object} opts.runtime 轨迹运行时（sessionId/executorNodeUuid/_lastMenuNavKey）
 * @param {number} opts.functionId 交易所属功能节点 id
 * @param {object} opts.execSession executor 会话客户端
 * @returns {Promise<{ navigated: boolean, reason: string }>} 是否执行了导航及原因
 */
export async function navigateToFunctionMenu({ runtime, functionId, execSession } = {}) {
  const fid = Number(functionId);
  if (!Number.isFinite(fid) || fid <= 0) return { navigated: false, reason: 'no-function' };

  let funcNode;
  try {
    funcNode = await systemDao.getRawById(fid);
  } catch (e) {
    console.warn(`[menu-nav] load function node failed: ${e?.message || e}`);
    return { navigated: false, reason: 'nav-failed' };
  }
  if (!funcNode) return { navigated: false, reason: 'no-function' };

  const functionXpath = String(funcNode.menuXpath || '').trim();
  let moduleXpath = '';
  const parentId = funcNode.parentId;
  if (parentId != null && Number.isFinite(Number(parentId)) && Number(parentId) > 0) {
    try {
      const moduleNode = await systemDao.getRawById(Number(parentId));
      if (moduleNode) moduleXpath = String(moduleNode.menuXpath || '').trim();
    } catch (e) {
      console.warn(`[menu-nav] load module node failed: ${e?.message || e}`);
    }
  }

  if (!moduleXpath && !functionXpath) return { navigated: false, reason: 'no-menu-xpath' };

  const navKey = `${moduleXpath || ''}|${functionXpath || ''}`;
  if (runtime._lastMenuNavKey === navKey) return { navigated: false, reason: 'same-menu' };

  const actions = buildMenuNavActions({ moduleXpath, functionXpath });
  if (actions.length === 0) return { navigated: false, reason: 'no-menu-xpath' };

  try {
    const doneP = execSession.waitForSessionEvent(
      runtime.sessionId,
      'replay_done',
      MENU_NAV_TIMEOUT_MS,
    );
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'replay_actions',
      data: {
        actions,
        is_replay: true,
        stop_on_fail: false,
      },
    });
    const result = await doneP;
    const failed = Number(result?.failed || 0);
    if (result?.error || failed > 0) {
      console.warn(`[menu-nav] nav replay failed (failed=${failed} error=${result?.error || ''})`);
      return { navigated: false, reason: 'nav-failed' };
    }
  } catch (e) {
    console.warn(`[menu-nav] nav replay error: ${e?.message || e}`);
    return { navigated: false, reason: 'nav-failed' };
  }

  runtime._lastMenuNavKey = navKey;
  return { navigated: true, reason: 'ok' };
}
