/**
 * 规范化并校验草稿轨迹 atom 的 produces / dataDependsOn 依赖图。
 * 纯函数，无 I/O。
 */

/**
 * 将原始依赖键规范化为 trim 后的字符串；空值得到空串。
 * @param {unknown} raw 原始键
 * @returns {string} trim 后的键；无效时为空串
 */
export function normalizeDependKey(raw) {
  return String(raw ?? '').trim();
}

/**
 * 将 produces 规范化为非空唯一键数组，保持首次出现顺序。
 * @param {unknown} raw 原始 produces 值
 * @returns {string[]} 去重后的键列表
 */
export function normalizeProduces(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const key = normalizeDependKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * 将 dataDependsOn 规范化为 `{ key, source }` 列表。
 *
 * 字符串项默认 `source: 'atom'`；对象读取 `key`/`name`，仅当 `source` 恰好为
 * `'preset'` 时保留 preset，否则视为 atom。空键丢弃，按 key 去重并保留首次。
 * @param {unknown} raw 原始 dataDependsOn 值
 * @returns {Array<{ key: string, source: 'atom' | 'preset' }>} 规范化依赖列表
 */
export function normalizeDataDependsOn(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    let key = '';
    let source = 'atom';
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      key = normalizeDependKey(item.key ?? item.name);
      source = item.source === 'preset' ? 'preset' : 'atom';
    } else {
      key = normalizeDependKey(item);
    }
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, source });
  }
  return out;
}

/**
 * 校验一批 atom 的 produces / dataDependsOn 图。
 *
 * 两字段均缺失时记软警告 `missing_depend_fields`；自产自依赖硬拒
 * `self_produce_depend`；`source==='atom'` 且键不在未拒收 atom 的 produced
 * 集合中则硬拒 `dangling_data_depend`。被拒 atom 不向 produced 集合贡献键。
 * @param {Array<{ atomKey?: string, produces?: unknown, dataDependsOn?: unknown }>} atoms atom 列表
 * @returns {{ rejected: Array<{ atomKey?: string, reason: string }>, warnings: Array<{ atomKey?: string, reason: string }> }} 拒收与警告
 */
export function validateAtomDependGraph(atoms) {
  const list = Array.isArray(atoms) ? atoms : [];
  /** @type {Array<{ atomKey?: string, reason: string }>} */
  const rejected = [];
  /** @type {Array<{ atomKey?: string, reason: string }>} */
  const warnings = [];

  /** @type {Array<{ atomKey?: string, produces: string[], depends: Array<{ key: string, source: string }>, selfRejected: boolean }>} */
  const normalized = [];

  for (const atom of list) {
    const atomKey = atom?.atomKey != null ? String(atom.atomKey) : undefined;
    const hasProduces = Object.prototype.hasOwnProperty.call(atom || {}, 'produces');
    const hasDepends = Object.prototype.hasOwnProperty.call(atom || {}, 'dataDependsOn');
    if (!hasProduces && !hasDepends) {
      warnings.push({ atomKey, reason: 'missing_depend_fields' });
    }
    const produces = normalizeProduces(atom?.produces);
    const depends = normalizeDataDependsOn(atom?.dataDependsOn);
    const produceSet = new Set(produces);
    let selfRejected = false;
    for (const d of depends) {
      if (produceSet.has(d.key)) {
        rejected.push({ atomKey, reason: 'self_produce_depend' });
        selfRejected = true;
        break;
      }
    }
    normalized.push({ atomKey, produces, depends, selfRejected });
  }

  const produced = new Set();
  for (const row of normalized) {
    if (row.selfRejected) continue;
    for (const k of row.produces) produced.add(k);
  }

  for (const row of normalized) {
    if (row.selfRejected) continue;
    for (const d of row.depends) {
      if (d.source === 'preset') continue;
      if (!produced.has(d.key)) {
        rejected.push({ atomKey: row.atomKey, reason: 'dangling_data_depend' });
        break;
      }
    }
  }

  return { rejected, warnings };
}
