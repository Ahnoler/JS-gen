/**
 * 可导航菜单 uml_ecd 唯一性守卫：仅当候选自身「有 xpath + 非空 uml」时，
 * 拒绝与另一已有 xpath 节点共用同一 uml_ecd。
 */
import { getDB } from '../../config/database.js';

export function isNavigableUmlPair(umlEcd, menuXpath) {
  return Boolean(String(umlEcd || '').trim() && String(menuXpath || '').trim());
}

/**
 * @param {{ umlEcd: string, menuXpath?: string, excludeNodeId?: number }} candidate
 * @param {object} [trx]
 * @returns {Promise<void>}
 */
export async function assertUmlEcdNavAvailable(candidate, trx) {
  const umlEcd = String(candidate?.umlEcd || '').trim();
  const menuXpath = String(candidate?.menuXpath || '').trim();
  if (!isNavigableUmlPair(umlEcd, menuXpath)) return;

  const client = trx || getDB();
  let q = client('system')
    .whereRaw("TRIM(uml_ecd) = ?", [umlEcd])
    .whereRaw("menu_xpath IS NOT NULL AND TRIM(menu_xpath) <> ''")
    .first('id', 'name', 'uml_ecd', 'menu_xpath');
  const exclude = Number(candidate?.excludeNodeId);
  if (Number.isFinite(exclude) && exclude > 0) {
    q = q.andWhereNot('id', exclude);
  }
  const hit = await q;
  if (!hit) return;
  throw Object.assign(
    new Error(
      `可导航菜单 uml_ecd 冲突：${umlEcd} 已被节点 ${hit.id}（${hit.name || ''}）占用`,
    ),
    { code: 'CONFLICT', conflict: { id: hit.id, name: hit.name, umlEcd: hit.uml_ecd } },
  );
}
