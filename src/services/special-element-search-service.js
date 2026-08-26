import * as specialElementDao from '../dao/special-element-dao.js';
import * as specialElementStepDao from '../dao/special-element-step-dao.js';
import * as sysDictDataDao from '../dao/sys-dict-data-dao.js';

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[\s,，、;；|/\\]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1);
}

/** Normalize common typos / aliases so tag「法定责任人」matches UI「法定代表人». */
/**
 * Normalize common typos / aliases so tag 法定责任人 matches UI 法定代表人.
 * @param {string} text input text
 * @returns {string} normalized text
 */
function normalizeLegalAliases(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/法定责任人/g, '法定代表人')
    .replace(/责任人的引入/g, '代表人的引入');
}

const INTRODUCE_HINT_RE = /引入|选人|放大镜|法定代表人|法定责任人/;

function stepSummary(steps = []) {
  return steps.slice(0, 8).map((s) => ({
    stepNumber: s.stepNumber,
    actionType: s.actionType,
  }));
}

/**
 * Hybrid lexical search within a system.
 * @param {object} opts search options
 * @param {number} opts.systemId system DB id
 * @param {string} [opts.description] natural-language description to match
 * @param {string} [opts.keyword] keyword to match
 * @param {number} [opts.limit] max results (default 3)
 * @param {boolean} [opts.includeSteps] whether to include full step data (default false)
 * @returns {Promise<Array<object>>} scored special-element candidates with match reasons
 */
export async function searchSpecialElements({
  systemId,
  description = '',
  keyword = '',
  limit = 3,
  includeSteps = false,
} = {}) {
  const sid = Number(systemId);
  if (!Number.isFinite(sid) || sid <= 0) return [];

  const queryText = String(description || keyword || '').trim();
  const queryNorm = normalizeLegalAliases(queryText);
  const tokens = tokenize(queryNorm);
  const elements = await specialElementDao.listEnabledBySystem(sid);
  if (!elements.length) return [];

  const tagCodes = [...new Set(elements.map((e) => Number(e.tagDictCode)).filter(Boolean))];
  const tagMap = new Map();
  for (const code of tagCodes) {
    const row = await sysDictDataDao.getById(code);
    if (row) tagMap.set(code, row);
  }

  const scored = [];
  for (const el of elements) {
    const tag = tagMap.get(Number(el.tagDictCode));
    const dictLabel = tag?.dictLabel || '';
    const dictValue = tag?.dictValue || '';
    const hayRaw = [
      el.name || '',
      dictLabel,
      dictValue,
      el.phaseDescription || '',
      el.remark || '',
      el.searchText || '',
    ].join(' ');
    const hay = normalizeLegalAliases(hayRaw);

    let tagScore = 0;
    let lexicalScore = 0;
    const matchReasons = [];

    if (queryText) {
      const q = queryNorm;
      const labelNorm = normalizeLegalAliases(dictLabel);
      const nameNorm = normalizeLegalAliases(el.name || '');
      if (labelNorm && q.includes(labelNorm)) {
        tagScore += 40;
        matchReasons.push(`标签匹配: ${dictLabel}`);
      } else if (
        labelNorm.includes('引入')
        && q.includes('引入')
        && (q.includes('代表人') || hay.includes('代表人'))
      ) {
        tagScore += 25;
        matchReasons.push(`标签近义: ${dictLabel}`);
      }
      if (dictValue && q.includes(String(dictValue).toLowerCase())) {
        tagScore += 30;
        matchReasons.push(`标签键值匹配: ${dictValue}`);
      }
      if (nameNorm && q.includes(nameNorm)) {
        lexicalScore += 35;
        matchReasons.push(`名称包含查询`);
      }
      const phaseNorm = normalizeLegalAliases(el.phaseDescription || '');
      if (phaseNorm && (
        phaseNorm.includes(q)
        || q.includes(phaseNorm.slice(0, 40))
      )) {
        lexicalScore += 25;
        matchReasons.push(`阶段描述相关`);
      }
      // Introduce / legal-person soft boost when both sides mention the workflow
      if (INTRODUCE_HINT_RE.test(q) && INTRODUCE_HINT_RE.test(hay)) {
        lexicalScore += 20;
        matchReasons.push('引入/选人语义相关');
      }
    }

    let covered = 0;
    for (const tok of tokens) {
      if (tok.length >= 2 && hay.includes(tok)) covered += 1;
    }
    if (tokens.length) {
      const coverage = covered / tokens.length;
      lexicalScore += Math.round(coverage * 30);
      if (coverage > 0) matchReasons.push(`关键词覆盖 ${covered}/${tokens.length}`);
    }

    // Soft prior: prefer shorter groups when scores tie later
    const total = tagScore + lexicalScore;
    if (total <= 0 && queryText) continue;
    if (!queryText) {
      // No query → return recent enabled items with weak score
      scored.push({
        id: el.id,
        name: el.name,
        dictLabel,
        dictValue,
        tagDictCode: el.tagDictCode,
        phaseDescription: el.phaseDescription,
        remark: el.remark,
        stepCount: el.stepCount,
        score: 1,
        tagScore: 0,
        lexicalScore: 1,
        matchReasons: ['系统内启用元素'],
        _el: el,
      });
      continue;
    }

    scored.push({
      id: el.id,
      name: el.name,
      dictLabel,
      dictValue,
      tagDictCode: el.tagDictCode,
      phaseDescription: el.phaseDescription,
      remark: el.remark,
      stepCount: el.stepCount,
      score: total,
      tagScore,
      lexicalScore,
      matchReasons: matchReasons.length ? matchReasons : ['弱相关'],
      _el: el,
    });
  }

  scored.sort((a, b) => b.score - a.score || Number(b.id) - Number(a.id));
  const top = scored.slice(0, Math.max(1, Math.min(20, Number(limit) || 3)));

  const out = [];
  for (const item of top) {
    const steps = includeSteps
      ? await specialElementStepDao.listByElement(item.id)
      : [];
    const { _el, ...rest } = item;
    out.push({
      ...rest,
      stepSummary: includeSteps
        ? stepSummary(steps)
        : stepSummary(await specialElementStepDao.listByElement(item.id)),
      ...(includeSteps
        ? {
          steps: steps.map((s) => ({
            id: s.id,
            stepNumber: s.stepNumber,
            actionIndex: s.actionIndex,
            action: s.actionType,
            actionType: s.actionType,
            params: s.paramsJson,
            element: s.elementJson,
          })),
        }
        : {}),
    });
  }
  return out;
}

/**
 * Lightweight display payload for phase snapshot / analyze response.
 * @param {Array<object>} candidates scored special-element candidates
 * @returns {Array<object>} display payload with selected fields
 */
export function toDisplayCandidates(candidates = []) {
  return candidates.map((c) => ({
    id: c.id,
    name: c.name,
    dictLabel: c.dictLabel,
    dictValue: c.dictValue,
    tagDictCode: c.tagDictCode,
    stepCount: c.stepCount,
    score: c.score,
    matchReasons: c.matchReasons,
    stepSummary: c.stepSummary,
    phaseDescription: c.phaseDescription,
    remark: c.remark,
  }));
}
