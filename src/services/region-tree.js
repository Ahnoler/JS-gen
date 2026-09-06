/**
 * 分区树（整页大树）+ 每步层级作证字段推导。
 * 节点 id = region_id 段（role:label）；parentId = 上一层段 id。
 * 遵守 PR-LAYER 锁定规则：page 只当根（内层 page 丢弃）；
 * 其余按 layers 前缀合并（同一父下同 id 同节点）。
 */

function layerIdOf(l) {
  const role = String(l?.role || '').replace(/\s+/g, ' ').trim();
  const label = String(l?.label || '').replace(/\s+/g, ' ').trim();
  return `${role}:${label}`;
}

/**
 * 从 element 推导最内层区域节点 id 与其父节点 id。
 * 回退链：layers → region_id 按 '|' 拆 → region_label/display_group 按 ' / ' 拆 → 空串。
 * @param {object} [element] element info with layers/region_id/region_label
 * @returns {{ regionId: string, parentRegionId: string }} region ref
 */
export function deriveRegionRef(element = {}) {
  const el = element && typeof element === 'object' ? element : {};
  const layers = Array.isArray(el.layers)
    ? el.layers.filter((l) => l && typeof l === 'object' && l.role && l.label != null)
    : [];
  if (layers.length) {
    const innermost = layers[layers.length - 1];
    const parent = layers.length > 1 ? layers[layers.length - 2] : null;
    return {
      regionId: layerIdOf(innermost),
      parentRegionId: parent ? layerIdOf(parent) : '',
    };
  }
  const rid = String(el.region_id || '').trim();
  if (rid) {
    const segs = rid.split('|').map((s) => s.trim()).filter(Boolean);
    if (segs.length) {
      return {
        regionId: segs[segs.length - 1],
        parentRegionId: segs.length > 1 ? segs[segs.length - 2] : '',
      };
    }
  }
  const path = String(el.region_label || el.display_group || '').trim();
  if (path) {
    const segs = path.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
    if (segs.length) {
      return {
        regionId: segs[segs.length - 1],
        parentRegionId: segs.length > 1 ? segs[segs.length - 2] : '',
      };
    }
  }
  return { regionId: '', parentRegionId: '' };
}

function ensureChild(parent, id, role, label) {
  if (parent) {
    let n = parent.children.find((c) => c.id === id && c.role === role);
    if (n) return n;
    n = { id, role, label, parentId: parent.id, children: [], controls: [] };
    parent.children.push(n);
    return n;
  }
  return null;
}

/**
 * items: [{ layers?: [{ role, label }] }]；controls 引用 elementIndex = 数组下标。
 * 无 layers 的控件进 { id:'other', role:'other', label:'其他' }。
 * @param {Array<object>} [items] element items with layers
 * @param {{ pageLabel?: string }} [opts] tree options
 * @returns {{ pageLabel: string, roots: object[] }} assembled region tree
 */
export function assembleRegionTree(items = [], { pageLabel = '' } = {}) {
  const rootPageLabel = String(pageLabel || '').trim();
  const roots = [];

  function ensureRoot(id, role, label) {
    let n = roots.find((r) => r.id === id && r.role === role);
    if (n) return n;
    n = { id, role, label, parentId: null, children: [], controls: [] };
    roots.push(n);
    return n;
  }

  const rootPage = rootPageLabel ? ensureRoot(`page:${rootPageLabel}`, 'page', rootPageLabel) : null;

  (items || []).forEach((item, elementIndex) => {
    const raw = Array.isArray(item?.layers) ? item.layers : [];
    let chain = raw.filter((l) => l && typeof l === 'object' && l.role && l.label != null);

    let parent = null;
    if (chain.length && String(chain[0].role) === 'page') {
      parent = ensureRoot(layerIdOf(chain[0]), 'page', String(chain[0].label));
      chain = chain.slice(1);
    } else if (rootPage) {
      parent = rootPage;
    }

    // PR-LAYER 锁定：page 只当根——链中其余 page 层一律丢弃（不挂为子节点）。
    chain = chain.filter((l) => String(l.role) !== 'page');

    if (!chain.length) {
      const other = parent
        ? ensureChild(parent, `${parent.id}|other`, 'other', '其他')
        : ensureRoot('other', 'other', '其他');
      other.controls.push({ elementIndex });
      return;
    }

    for (const l of chain) {
      const node = parent
        ? ensureChild(parent, layerIdOf(l), String(l.role), String(l.label))
        : ensureRoot(layerIdOf(l), String(l.role), String(l.label));
      parent = node;
    }
    parent.controls.push({ elementIndex });
  });

  return { pageLabel: rootPageLabel, roots };
}
