/**
 * 权重引擎（P1 完整版）。
 *
 * P0：来源基准表 + stance 系数 + 初始权重计算。
 * P1：时间衰减（recencyFactor）+ 冲突惩罚（superseded ×0.6）+ computeWeight 完整公式
 * （见方案 §5.3.1：weight(t) = base × recency × stance × conflict_penalty）。
 */

/** 来源基准权重（方案 §5.3.2）。 */
export const SOURCE_BASE_WEIGHT = {
  requirement: 1.0, // 用户输入的权威数据，不可被 LLM 覆盖
  rule: 0.9,        // 规则生成，确定性最高
  page: 0.8,        // 页面 DOM / 表单回显 / 校验错误
  observer: 0.7,    // CDP / 操作日志 / 通知
  llm: 0.5,         // 推断性质，必须可被权威值覆盖
  human: 1.0,       // 人工优先级最高
  user: 1.0,        // 与 requirement 同源语义
  agent: 0.7,       // agent 动作结果
  system: 0.6,      // 系统注入（context_drop 等）
};

/** stance 系数（方案 §5.3.1）。 */
export const STANCE_FACTOR = {
  authoritative: 1.5,
  inferred: 0.8,
  disputed: 0.5,
  neutral: 1.0,
};

/** 来源 → 初始基准权重（未知来源按 0.6）。 */
export function baseWeightFor(source) {
  const v = String(source || '').toLowerCase();
  return SOURCE_BASE_WEIGHT[v] ?? 0.6;
}

/** stance → 系数（未知 stance 按 1.0）。 */
export function stanceFactorFor(stance) {
  const v = String(stance || '').toLowerCase();
  return STANCE_FACTOR[v] ?? 1.0;
}

/**
 * P0 初始权重：base × stance。
 * @param {object} opts
 * @param {string} [opts.source]
 * @param {string} [opts.stance]
 * @param {number} [opts.baseWeight] 显式覆盖来源基准
 * @returns {number}
 */
export function initialWeight({ source = 'agent', stance = 'neutral', baseWeight = null } = {}) {
  const base = Number.isFinite(baseWeight) ? Number(baseWeight) : baseWeightFor(source);
  return Number((base * stanceFactorFor(stance)).toFixed(4));
}

/** 冲突惩罚：被新版本覆盖过（superseded_by 非空）→ ×0.6（方案 §5.3.1）。 */
export const CONFLICT_PENALTY = 0.6;

/** 时间衰减半衰期（毫秒）：默认 1 小时；阶段内场景可传 5 分钟。 */
export const DEFAULT_HALF_LIFE_MS = 60 * 60 * 1000;

/**
 * 时间衰减因子：recency(t) = 0.5^(age / half_life)。
 * created_at 缺失/无效视为 1（不衰减）。
 */
export function recencyFactor(createdAt, now = Date.now(), halfLifeMs = DEFAULT_HALF_LIFE_MS) {
  if (!createdAt) return 1;
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return 1;
  const age = Math.max(0, now - t);
  if (!Number.isFinite(halfLifeMs) || halfLifeMs <= 0) return 1;
  return Math.pow(0.5, age / halfLifeMs);
}

/**
 * 存储权重：base × stance（摄入时落库；不含时间衰减——衰减是检索时的动态量）。
 * 被 superseded 的事实按 disputed stance 重算（审计保留的低权重版本）。
 */
export function storedWeight({ source = 'agent', stance = 'neutral', baseWeight = null } = {}) {
  const base = Number.isFinite(baseWeight) ? baseWeight : baseWeightFor(source);
  return Number((base * stanceFactorFor(stance)).toFixed(4));
}

/**
 * 计算当前权重（P1 完整公式，方案 §5.3.1）：
 *   weight(t) = base × recency(t) × stance_factor × conflict_penalty
 * 检索场景调用：存储权重 × 时间衰减 × （superseded → 冲突惩罚）。
 */
export function computeWeight(fact = {}, now = Date.now()) {
  const base = Number.isFinite(fact.baseWeight) ? fact.baseWeight : baseWeightFor(fact.source);
  let w = base * stanceFactorFor(fact.stance);
  if (fact.supersededBy != null) w *= CONFLICT_PENALTY;
  w *= recencyFactor(fact.createdAt, now);
  return Number(w.toFixed(4));
}
