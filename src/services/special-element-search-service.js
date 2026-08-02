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

function stepSummary(steps = []) {
  return steps.slice(0, 8).map((s) => ({
    stepNumber: s.stepNumber,
    actionType: s.actionType,
  }));
}

/**
 * Hybrid lexical search within a system.
 * @param {{ systemId: number, description?: string, keyword?: string, limit?: number, includeSteps?: boolean }} opts
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
  const tokens = tokenize(queryText);
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
    const hay = [
      el.name || '',
      dictLabel,
      dictValue,
      el.phaseDescription || '',
      el.remark || '',
      el.searchText || '',
    ].join(' ').toLowerCase();

    let tagScore = 0;
    let lexicalScore = 0;
    const matchReasons = [];

    if (queryText) {
      const q = queryText.toLowerCase();
      if (dictLabel && q.includes(dictLabel.toLowerCase())) {
        tagScore += 40;
        matchReasons.push(`标签匹配: ${dictLabel}`);
      }
      if (dictValue && q.includes(dictValue.toLowerCase())) {
        tagScore += 30;
        matchReasons.push(`标签键值匹配: ${dictValue}`);
      }
      if (el.name && q.includes(String(el.name).toLowerCase())) {
        lexicalScore += 35;
        matchReasons.push(`名称包含查询`);
      }
      if (el.phaseDescription && (
        String(el.phaseDescription).toLowerCase().includes(q)
        || q.includes(String(el.phaseDescription).toLowerCase().slice(0, 40))
      )) {
        lexicalScore += 25;
        matchReasons.push(`阶段描述相关`);
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

/** Lightweight display payload for phase snapshot / analyze response. */
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
  }));
}
