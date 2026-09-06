/**
 * 菜单扫描 service 入口（薄封装 + 纯函数锚点）：
 * - 任务登记/单飞（startScan/getScan）→ menu-scan-job.js
 * - 会话编排/阶段二（runScan/runPhase2Match）→ menu-scan-session.js
 * - 事务落库（applyScanPlan）→ menu-scan-apply.js
 * - buildScanApplyPlan 纯函数（无 DB/网络依赖）保留在本文件——characterize-menu-scan.mjs
 *   钉住本文件的导出面（startScan/getScan/buildScanApplyPlan）。
 */
export { startScan, getScan, startFillPageIds } from './menu-scan-job.js';

/**
 * 从 menu xpath 抽出 data-id（如 RES04066）；抽不出则返回 ''。
 * @param {string} xpath menu xpath
 * @returns {string} data-id or empty
 */
export function extractMenuDataId(xpath) {
  const m = String(xpath || '').match(/data-id=['"]([^'"]+)['"]/i);
  return m ? String(m[1]).trim() : '';
}

/**
 * 构建菜单扫描结果的应用计划（纯函数，禁止碰 DB/网络）。
 *
 * 匹配规则：L1 按 `name` trim 后精确匹配既有模块名；
 * L2 优先按 `parentName` 下子节点 `menuXpath` 的 data-id 命中（命中则 updates，名称不同时带 `name` 改为 SUT 文案），
 * 其次按同名命中——但仅当该子节点 xpath 为空或 data-id 与扫描一致（避免把叶子 xpath 写到错名幽灵上）；
 * 再其次按同名 `intermediateFlag===1` 子节点升格（`promote: true`）；
 * 否则 creates。
 * 命中 → `updates`（带 menuXpath）；若该节点 `unmatchedFlag===1` → 同时记入 `clearedUnmatched`。
 * 未命中 → `creates`（L1 带 `parentName:''`，L2 带 parentName）。
 * @param {Array<{ level: 1|2, name: string, parentName?: string, xpath: string }>} scannedMenus 扫描到的菜单项
 * @param {Array<object>} existingModules 既有模块（含功能 children），每个元素含 id/name/source/unmatchedFlag
 * @returns {{ updates: Array<object>, creates: Array<object>, clearedUnmatched: number[], stats: object }} 应用计划，含 updates/creates/clearedUnmatched 与 stats（totalScanned/matched/created/clearedUnmatched/unmatchedScanned）
 */
export function buildScanApplyPlan(scannedMenus, existingModules) {
  const menus = Array.isArray(scannedMenus) ? scannedMenus : [];
  const modules = Array.isArray(existingModules) ? existingModules : [];

  const updates = [];
  const creates = [];
  const clearedUnmatched = [];
  const unmatchedScanned = [];

  // L1 名称索引：trim 后精确匹配。
  const l1Index = new Map();
  for (const mod of modules) {
    l1Index.set(String(mod.name || '').trim(), mod);
  }

  let matched = 0;
  const l1CreatedNames = new Set();

  // sortOrder 计数器：L1 全局下标（0-based，按 level===1 出现序）；
  // L2 按 parentName 分组下标（每个 parentName 独立从 0 计数）。
  let l1Sort = 0;
  const l2SortByParent = new Map();

  for (const m of menus) {
    const level = Number(m.level);
    const name = String(m.name || '').trim();
    const parentName = String(m.parentName || '').trim();
    const xpath = String(m.xpath || '');

    if (!name) continue;

    if (level === 1) {
      const sortOrder = l1Sort;
      l1Sort += 1;
      const mod = l1Index.get(name);
      if (mod) {
        updates.push({ nodeId: mod.id, menuXpath: xpath, sortOrder });
        matched += 1;
        if (Number(mod.unmatchedFlag) === 1) clearedUnmatched.push(mod.id);
      } else {
        creates.push({ level: 1, name, parentName: '', xpath, sortOrder });
        l1CreatedNames.add(name);
      }
      continue;
    }

    if (level === 2) {
      const sortOrder = l2SortByParent.get(parentName) || 0;
      l2SortByParent.set(parentName, sortOrder + 1);
      const parentMod = l1Index.get(parentName);
      const kids = parentMod && Array.isArray(parentMod.children) ? parentMod.children : [];
      const navKids = kids.filter((c) => Number(c.intermediateFlag) !== 1);
      const scanDataId = extractMenuDataId(xpath);

      let fnNode = null;
      let renameTo = '';
      if (scanDataId) {
        fnNode =
          navKids.find((c) => extractMenuDataId(c.menuXpath) === scanDataId) || null;
        if (fnNode && String(fnNode.name || '').trim() !== name) {
          renameTo = name;
        }
      }
      if (!fnNode) {
        const byName = navKids.find((c) => String(c.name || '').trim() === name) || null;
        if (byName) {
          const existingId = extractMenuDataId(byName.menuXpath);
          // 已有不同 data-id 时不把扫描 xpath 盖到错名节点上 → 走 creates
          if (!existingId || existingId === scanDataId) {
            fnNode = byName;
          }
        }
      }

      if (fnNode) {
        const u = { nodeId: fnNode.id, menuXpath: xpath, sortOrder };
        if (renameTo) u.name = renameTo;
        updates.push(u);
        matched += 1;
        if (Number(fnNode.unmatchedFlag) === 1) clearedUnmatched.push(fnNode.id);
      } else {
        const interByName = kids.find(
          (c) => Number(c.intermediateFlag) === 1 && String(c.name || '').trim() === name,
        );
        if (interByName) {
          updates.push({ nodeId: interByName.id, menuXpath: xpath, sortOrder, promote: true });
          matched += 1;
          continue;
        }
        creates.push({ level: 2, name, parentName, xpath, sortOrder });
      }
      continue;
    }
    // 其他层级忽略。
  }

  for (const c of creates) {
    unmatchedScanned.push({ name: c.name, parentName: c.parentName });
  }

  return {
    updates,
    creates,
    clearedUnmatched,
    stats: {
      totalScanned: menus.length,
      matched,
      created: creates.length,
      clearedUnmatched: clearedUnmatched.length,
      unmatchedScanned,
    },
  };
}
