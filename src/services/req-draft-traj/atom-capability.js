/**
 * 检测草稿 taskDraft 是否把互不相关的可录能力写进同一 atom。
 *
 * 当前闸：产品树同层排序（上移/下移）不得与详情页维护基本信息【保存】合并。
 * 纯函数，无 I/O。
 */

const SORT_CAPABILITY_RE = /同层排序|上移|下移/;
const BASIC_INFO_RE = /维护基本信息/;
const DETAIL_SAVE_RE = /【保存】/;

/**
 * True when haystack mixes tree-sort with detail-page maintain/save.
 *
 * 上移/下移（或「同层排序」）是独立可录能力，不得当作维护基本信息【保存】的前序。
 * #708 形（搜索/定位选中对象 → 基本信息页签 → 一次保存、无排序）返回 false。
 * @param {unknown} text Title and/or taskDraft haystack
 * @returns {boolean} True when the two capabilities appear together
 */
export function mixesSortWithBasicInfoSave(text) {
  const src = String(text || '');
  if (!SORT_CAPABILITY_RE.test(src)) return false;
  return BASIC_INFO_RE.test(src) || DETAIL_SAVE_RE.test(src);
}
