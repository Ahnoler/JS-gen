/**
 * Structural signature for operation-component mining.
 * Includes stable semantic fields (label_text, etc.); excludes free-form fill values.
 */
import { createHash } from 'crypto';

const LABEL_KEYS = ['label_text', 'label', 'field_label'];
const OPTION_KEYS = ['option_text', 'option'];
const CLICK_TEXT_KEYS = ['menu_text', 'button_text', 'text'];

const FILL_ACTIONS = new Set([
  'fill_form_field',
  'fill_input',
  'type_text',
  'input_text',
]);

const CLICK_ACTIONS = new Set([
  'click_menu_item',
  'click_button',
  'click_element',
  'click_element_by_index',
  'click_table_row_button',
  'click',
]);

/**
 * @param {unknown} v
 * @returns {string}
 */
export function normalizeSemanticText(v) {
  if (v == null) return '';
  return String(v).trim().replace(/\s+/g, ' ');
}

/**
 * @param {Record<string, unknown>|null|undefined} params
 * @returns {string[]}
 */
export function sortedParamKeys(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return [];
  return Object.keys(params).sort();
}

/**
 * @param {string} actionType
 * @param {Record<string, unknown>|null|undefined} params
 * @returns {Record<string, string>}
 */
export function extractStableSemantics(actionType, params) {
  const at = String(actionType || '').trim();
  const p = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
  /** @type {Record<string, string>} */
  const out = {};

  for (const k of LABEL_KEYS) {
    const n = normalizeSemanticText(p[k]);
    if (n) {
      out[k] = n;
      break;
    }
  }

  if (/select/i.test(at) || at === 'select_option') {
    for (const k of OPTION_KEYS) {
      const n = normalizeSemanticText(p[k]);
      if (n) {
        out[k] = n;
        break;
      }
    }
  }

  if (CLICK_ACTIONS.has(at) || /^click_/i.test(at)) {
    for (const k of CLICK_TEXT_KEYS) {
      if (k === 'text' && FILL_ACTIONS.has(at)) continue;
      const n = normalizeSemanticText(p[k]);
      if (n) {
        out[k] = n;
        break;
      }
    }
  }

  return out;
}

/**
 * Build one step's signature fragment (deterministic JSON-serializable).
 * @param {{ actionType?: string, action?: string, params?: Record<string, unknown>|null, paramsJson?: Record<string, unknown>|null }} step
 */
export function stepSignatureFragment(step) {
  const actionType = String(step.actionType ?? step.action ?? '').trim();
  const params = step.params ?? step.paramsJson ?? null;
  return {
    actionType,
    paramKeys: sortedParamKeys(params),
    semantics: extractStableSemantics(actionType, params),
  };
}

/**
 * @param {Array<{ actionType?: string, action?: string, params?: object|null, paramsJson?: object|null, stepNumber?: number }>} steps
 * @returns {{ signature: string, fragments: object[] }}
 */
export function computePhaseSignature(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const usable = list
    .slice()
    .sort((a, b) => {
      const an = Number(a.stepNumber) || 0;
      const bn = Number(b.stepNumber) || 0;
      return an - bn;
    });
  const fragments = usable.map(stepSignatureFragment);
  const payload = JSON.stringify(fragments);
  const signature = createHash('sha256').update(payload).digest('hex');
  return { signature, fragments };
}

/**
 * Normalize DB / API step rows into steps_json snapshot items.
 * @param {Array<object>} steps
 * @returns {Array<{ actionType: string, params: object|null, elementJson: object|null }>}
 */
export function stepsToSnapshot(steps) {
  const list = Array.isArray(steps) ? steps : [];
  return list
    .slice()
    .sort((a, b) => (Number(a.stepNumber) || 0) - (Number(b.stepNumber) || 0))
    .map((s) => {
      let params = s.params ?? s.paramsJson ?? null;
      if (typeof params === 'string') {
        try { params = JSON.parse(params); } catch { params = null; }
      }
      let elementJson = s.element ?? s.elementJson ?? null;
      if (typeof elementJson === 'string') {
        try { elementJson = JSON.parse(elementJson); } catch { elementJson = null; }
      }
      return {
        actionType: String(s.actionType ?? s.action ?? '').trim(),
        params: params && typeof params === 'object' ? params : null,
        elementJson: elementJson && typeof elementJson === 'object' ? elementJson : null,
      };
    });
}

/**
 * Parse LLM JSON with the same fallback ladder as analyzeRequirementToPhases.
 * @param {string} raw
 * @returns {object|null}
 */
export function parseLlmJsonObject(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
  } catch { /* continue */ }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const obj = JSON.parse(text.slice(firstBrace, lastBrace + 1));
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    } catch { /* continue */ }
  }

  return null;
}
