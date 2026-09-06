/**
 * Fact Pack 组装：按权重排序 + 预算裁剪。
 * 被裁剪的事实必须进入 dropped（不允许静默丢失，见方案 §5.4.3）。
 */

/**
 * 单条事实 → 可注入文本。
 * @param {object} [fact] Fact row (id / entity / attribute / value / source / stance / weight).
 * @returns {string} Formatted fact line for injection.
 */
export function formatFact(fact = {}) {
  const entity = String(fact.entity || '?');
  const attribute = String(fact.attribute || 'value');
  const value = String(fact.value ?? '').slice(0, 200);
  const source = String(fact.source || 'unknown');
  const stance = String(fact.stance || 'neutral');
  // 优先检索时的有效权重（存储权重 × 时间衰减 × 冲突惩罚）；缺失回退存储权重
  const weight = Number.isFinite(Number(fact.effectiveWeight))
    ? Number(fact.effectiveWeight)
    : (Number.isFinite(Number(fact.weight)) ? Number(fact.weight) : 0);
  return `- #${fact.id} [${stance}/${source}] ${entity}.${attribute} = ${value} (weight=${weight})`;
}

/**
 * 组装 Fact Pack。
 * @param {Array<object>} facts 已按 weight desc 排序
 * @param {object} opts Pack options.
 * @param {number} [opts.maxChars] Max total chars (default 2000).
 * @param {number} [opts.limit] Max item count (default 50).
 * @returns {{ facts: object[], dropped: Array<{ factId: number, entity: string, reason: string }>, budget: { used: number, max: number, limit: number } }} Picked facts + dropped reasons + budget usage.
 */
export function buildFactPack(facts, { maxChars = 2000, limit = 50 } = {}) {
  const picked = [];
  const dropped = [];
  let used = 0;
  const max = Math.max(200, Number(maxChars) || 2000);
  const maxItems = Math.max(1, Number(limit) || 50);

  for (const f of Array.isArray(facts) ? facts : []) {
    const line = formatFact(f);
    const size = line.length + 1;
    if (picked.length >= maxItems || used + size > max) {
      dropped.push({
        factId: f.id,
        entity: f.entity,
        reason: used + size > max ? 'budget' : 'limit',
      });
      continue;
    }
    picked.push(f);
    used += size;
  }

  return {
    facts: picked,
    dropped,
    budget: { used, max, limit: maxItems },
  };
}
