/**
 * 菜单扫描第二阶段：列举空 pageId 的 L2 功能节点，点读天元并写入落地页。
 */
import { REPLAY_PHASE2_TIMEOUT_MS } from '../../config/config.js';
import * as systemDao from '../dao/system-dao.js';
import { NODE_TYPE } from '../models/hierarchy-constants.js';
import { runReplayActions } from './replay-actions.js';
import { writeFunctionLandingPage } from './function-landing-page.js';

const PAGEID_FILL_MAX = 500; // 硬上限，防超长扫描（信贷 AI 空 pageId ~234）

/**
 * 列举系统下 pd_cmpt_ecd 为空的功能节点（L2 候选）。
 * @param {object[]} allNodes systemDao.listAll 行
 * @param {number} systemNodeId 系统节点 id
 * @param {{ sources?: string[] }} [opts] 可选；`sources` 非空时只保留这些 source（如 `['ai']`）
 * @returns {Array<{ id: number, name: string, menuXpath: string, parentId: number, source: string }>} 候选功能列表
 */
export function listEmptyPageIdFunctions(allNodes, systemNodeId, opts = {}) {
  const sourceSet = Array.isArray(opts.sources) && opts.sources.length
    ? new Set(opts.sources.map((s) => String(s || '').trim()).filter(Boolean))
    : null;
  const modules = (allNodes || []).filter(
    (n) => Number(n.type) === NODE_TYPE.MODULE && Number(n.parentId) === Number(systemNodeId),
  );
  const moduleIds = new Set(modules.map((m) => Number(m.id)));
  return (allNodes || [])
    .filter((n) => Number(n.type) === NODE_TYPE.FUNCTION && moduleIds.has(Number(n.parentId)))
    .filter((n) => !String(n.pdCmptEcd || '').trim())
    .filter((n) => !sourceSet || sourceSet.has(String(n.source || '').trim()))
    .map((n) => ({
      id: Number(n.id),
      name: String(n.name || ''),
      menuXpath: String(n.menuXpath || '').trim(),
      parentId: Number(n.parentId),
      source: String(n.source || '').trim(),
    }))
    // Same L1 consecutive → fill can skip re-clicking module xpath
    .sort((a, b) => (a.parentId - b.parentId) || (a.id - b.id));
}

/**
 * 对空 pageId 候选逐个点读天元并写入落地页。
 * @param {object} opts 补采参数
 * @param {number} opts.systemNodeId 系统节点 id
 * @param {{ sessionId: string, nodeUuid: string }} opts.runtime 执行会话运行时
 * @param {object} opts.execSession executor 会话（forwardStdin / waitForSessionEvent）
 * @param {string[]} [opts.sources] 可选 source 过滤（如 `['ai']`）；省略则不限 source
 * @returns {Promise<{ pageIdCandidates: number, pageIdFilled: number, pageIdSkipped: number }>} 补采统计
 */
export async function fillEmptyPageIdsForSystem({ systemNodeId, runtime, execSession, sources } = {}) {
  const all = await systemDao.listAll();
  const candidates = listEmptyPageIdFunctions(all, systemNodeId, { sources });
  const byId = new Map(all.map((n) => [Number(n.id), n]));
  let pageIdFilled = 0;
  let pageIdSkipped = 0;
  const limit = Math.min(candidates.length, PAGEID_FILL_MAX);
  let lastModuleXpath = '';

  for (let i = 0; i < limit; i += 1) {
    const c = candidates[i];
    try {
      const parent = byId.get(Number(c.parentId));
      const moduleXpath = String(parent?.menuXpath || '').trim();
      const functionXpath = c.menuXpath;
      if (!functionXpath) {
        pageIdSkipped += 1;
        continue;
      }
      const actions = [];
      // Same L1 as previous candidate: skip redundant module click
      if (moduleXpath && moduleXpath !== lastModuleXpath) {
        actions.push({ action: 'click_menu_xpath', params: { xpath: moduleXpath } });
      }
      actions.push({ action: 'click_menu_xpath', params: { xpath: functionXpath } });
      actions.push({ action: 'read_page_component_code', params: {} });

      const { result: r } = await runReplayActions({
        execSession,
        sessionId: runtime.sessionId,
        nodeUuid: runtime.nodeUuid,
        actions,
        timeoutMs: REPLAY_PHASE2_TIMEOUT_MS,
        stopOnFail: false,
        isReplay: true,
      });
      const results = Array.isArray(r?.results) ? r.results : [];
      const functionClickRow = results.find(
        (it) => it && it.action === 'click_menu_xpath' && it.params?.xpath === functionXpath,
      );
      if (!functionClickRow?.ok) {
        pageIdSkipped += 1;
        lastModuleXpath = ''; // force re-expand next time
        continue;
      }
      if (moduleXpath) lastModuleXpath = moduleXpath;
      const row = results.find((it) => it && it.action === 'read_page_component_code');
      const payload = row?.pageCode && typeof row.pageCode === 'object' ? row.pageCode : {};
      const componentCode = String(payload.componentCode || '').trim();
      const scenarioCode = String(payload.scenarioCode || '').trim();
      const pageId = componentCode || scenarioCode;
      if (!pageId || pageId.startsWith('AILZ')) {
        pageIdSkipped += 1;
        continue;
      }
      const wrote = await writeFunctionLandingPage(c.id, {
        pageId,
        pageName: String(payload.pageName || '').trim(),
        resPath: String(payload.pagePath || '').trim(),
      });
      if (wrote) {
        pageIdFilled += 1;
      } else {
        pageIdSkipped += 1;
      }
    } catch (err) {
      pageIdSkipped += 1;
      lastModuleXpath = '';
      console.warn('[menu-scan-pageid] skip function#%s: %s', c.id, err?.message || err);
    }
  }
  // 超出硬上限的候选计为 skipped
  pageIdSkipped += Math.max(0, candidates.length - limit);

  return {
    pageIdCandidates: candidates.length,
    pageIdFilled,
    pageIdSkipped,
  };
}
