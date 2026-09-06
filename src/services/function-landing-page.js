/**
 * 功能节点落地 pageId 写入（pd_cmpt_ecd + system_page 单行）。
 * 失败只 warn，不抛。
 */
import * as systemDao from '../dao/system-dao.js';
import * as systemPageDao from '../dao/system-page-dao.js';

/**
 * @param {number} functionId 功能节点 id
 * @param {{ pageId: string, pageName?: string, resPath?: string }} landing 落地页
 * @returns {Promise<boolean>} 写入成功为 true；空 pageId、无效 id 或 DB 失败为 false
 */
export async function writeFunctionLandingPage(functionId, landing) {
  const pageId = String(landing?.pageId || '').trim();
  if (!pageId) return false;
  const fid = Number(functionId);
  if (!Number.isFinite(fid) || fid <= 0) return false;
  try {
    await systemDao.update(fid, { pdCmptEcd: pageId });
    await systemPageDao.replaceForNode(fid, [{
      pageId,
      pageName: String(landing.pageName || '').trim(),
      resPath: String(landing.resPath || '').trim(),
      pageType: 'managePage',
    }]);
    console.log('[landing] wrote function#%s pageId=%s', fid, pageId);
    return true;
  } catch (err) {
    console.warn('[landing] write failed function#%s: %s', fid, err?.message || err);
    return false;
  }
}
