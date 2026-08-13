import { filterMetaSteps } from './meta-step-actions.js';

function asElement(step) {
  let el = step?.element ?? step?.elementJson ?? null;
  if (typeof el === 'string') {
    try { el = JSON.parse(el); } catch { el = null; }
  }
  return el && typeof el === 'object' ? el : {};
}

export function collectHighlightTargets(steps) {
  const business = filterMetaSteps(Array.isArray(steps) ? steps : []);
  const out = [];
  for (const step of business) {
    const el = asElement(step);
    const xpath_smart = String(el.xpath_smart || '').trim();
    const xpath_full = String(el.xpath_full || el.xpath || '').trim();
    if (!xpath_smart && !xpath_full) continue;
    out.push({
      xpath_smart,
      xpath_full,
      region_id: String(el.region_id || '').trim(),
      region_label: String(el.region_label || '').trim(),
    });
  }
  return out;
}
