/**
 * Load SUT-settled wording hints for atomize (wet-test rulings + optional sut-settled.md).
 * Truth order: SUT wet-test / sut-settled.md over requirement overview wording.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Optional hand-maintained settled facts under the req module dir. */
export const SUT_SETTLED_FILENAME = 'sut-settled.md';

/** Wet-test evidence table filename. */
export const WET_TEST_FILENAME = 'wet-test.md';

/**
 * @typedef {{ text: string, source: string }} SutSettledHint
 */

/**
 * Normalize hint text for dedupe (strip markdown emphasis / collapse space).
 * @param {string} text Raw hint
 * @returns {string} Normalized key
 */
function normalizeHintKey(text) {
  return String(text || '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract settled-hint lines from wet-test markdown.
 * Prefer「预置疑点核对结论」numbered rulings; then evidence-table 裁定 cells.
 * @param {string} markdown wet-test.md body
 * @returns {SutSettledHint[]} Deduped hints (order preserved)
 */
export function extractSutSettledHintsFromWetTest(markdown) {
  const src = String(markdown || '');
  if (!src.trim()) return [];

  /** @type {SutSettledHint[]} */
  const out = [];
  const seen = new Set();

  /**
   * @param {string} text
   * @param {string} source
   */
  const push = (text, source) => {
    let t = String(text || '').replace(/\s+/g, ' ').trim();
    t = t.replace(/\*+$/, '').trim();
    if (!t || t.length < 8) return;
    const key = normalizeHintKey(t);
    if (!key || seen.has(key)) return;
    // Drop if already covered by a longer hint (avoid truncated cell fragments)
    for (const existing of seen) {
      if (existing.includes(key) || key.includes(existing)) {
        if (key.length <= existing.length) return;
        // Replace shorter with longer: remove shorter from out/seen
        for (let i = out.length - 1; i >= 0; i -= 1) {
          if (normalizeHintKey(out[i].text) === existing) {
            out.splice(i, 1);
            seen.delete(existing);
            break;
          }
        }
        break;
      }
    }
    seen.add(key);
    out.push({ text: t, source });
  };

  const conclusionMatch = src.match(
    /###\s*预置疑点核对结论\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/,
  );
  if (conclusionMatch) {
    for (const line of conclusionMatch[1].split(/\r?\n/)) {
      const m = line.match(/^\s*\d+\.\s*(.+)$/);
      if (!m) continue;
      const body = m[1].trim();
      // Keep rulings that mention SUT / 定案 / wording drift / 实际=
      if (/定案|SUT\s*实际\s*=|SUT\s*实际|wording\s*drift|无【/.test(body)) {
        // Skip open questions still pending
        if (/待核|未验证|留待补测|无法只读验证|不成立亦不证伪|无法核对/.test(body)
          && !/SUT\s*实际\s*=/.test(body)) {
          continue;
        }
        push(body, 'wet-test.md#预置疑点核对结论');
      }
    }
  }

  // Evidence-table cells that explicitly 裁定 button/query wording
  for (const line of src.split(/\r?\n/)) {
    if (!/\|/.test(line)) continue;
    if (!/裁定|定案|SUT\s*实际\s*=/.test(line)) continue;
    const cell = line.match(
      /\*\*按钮文案双候选裁定[^*]*\*\*[：:]\s*([^*（(]+)/,
    );
    if (cell) {
      push(cell[1].trim().replace(/，\s*$/, ''), 'wet-test.md#证据表');
      continue;
    }
    const sutInCell = line.match(/SUT\s*实际\s*=\s*(【[^】]+】)/);
    if (sutInCell && /裁定|定案/.test(line)) {
      push(`SUT 实际=${sutInCell[1]}`, 'wet-test.md#证据表');
    }
  }

  return out;
}

/**
 * Parse optional sut-settled.md bullet list into hints.
 * @param {string} markdown sut-settled.md body
 * @returns {SutSettledHint[]} Hints
 */
export function extractSutSettledHintsFromSettledFile(markdown) {
  const src = String(markdown || '');
  /** @type {SutSettledHint[]} */
  const out = [];
  const seen = new Set();
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+(.+)$/);
    if (!m) continue;
    const t = m[1].replace(/\s+/g, ' ').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push({ text: t, source: SUT_SETTLED_FILENAME });
  }
  return out;
}

/**
 * Merge wet-test extracts with optional sut-settled.md (settled file wins on duplicate text).
 * @param {{ wetTestMarkdown?: string, settledMarkdown?: string }} parts Source texts
 * @returns {SutSettledHint[]} Merged hints
 */
export function mergeSutSettledHints({ wetTestMarkdown = '', settledMarkdown = '' } = {}) {
  const fromWet = extractSutSettledHintsFromWetTest(wetTestMarkdown);
  const fromFile = extractSutSettledHintsFromSettledFile(settledMarkdown);
  /** @type {SutSettledHint[]} */
  const out = [];
  const seen = new Set();
  // Prefer explicit sut-settled.md first (hand-curated / newer)
  for (const h of [...fromFile, ...fromWet]) {
    const key = normalizeHintKey(h.text);
    if (!key || seen.has(key)) continue;
    // Skip wet-test fragment already covered by a settled-file bullet
    let covered = false;
    for (const existing of seen) {
      if (existing.includes(key) || key.includes(existing)) {
        covered = true;
        break;
      }
    }
    if (covered) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

/**
 * Load settled hints from a req module directory (best-effort; missing files → []).
 * @param {string} modDir Absolute module workspace path
 * @returns {Promise<SutSettledHint[]>} Hints for atomize payload
 */
export async function loadSutSettledHints(modDir) {
  let wetTestMarkdown = '';
  let settledMarkdown = '';
  try {
    wetTestMarkdown = await readFile(join(modDir, WET_TEST_FILENAME), 'utf-8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  try {
    settledMarkdown = await readFile(join(modDir, SUT_SETTLED_FILENAME), 'utf-8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return mergeSutSettledHints({ wetTestMarkdown, settledMarkdown });
}
