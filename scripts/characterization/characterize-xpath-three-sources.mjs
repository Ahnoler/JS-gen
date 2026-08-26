/**
 * Three-source relative-XPath consistency regression guard (Task 6).
 *
 * Proves that the three write paths (AI recording / manual recording / auto-grab)
 * produce identical xpath_smart / xpath_full / candidates / locator_strategy /
 * target_kind for the same DOM node, because all three now call the shared
 * buildLocatorSnap from PAGE_LOCATOR_HELPERS with a unified feeding convention
 * (Task 1-5, commits d6d7c6d..4eab70c).
 *
 * The test extracts each entry's function body + its file-local helpers from the
 * REAL source files (no copy-paste), injects PAGE_LOCATOR_HELPERS as the shared
 * dependency, then runs all three against the same fixture nodes and asserts
 * deep-equality across 5 fields.
 *
 *   node scripts/characterization/characterize-xpath-three-sources.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { PAGE_LOCATOR_HELPERS } from '../../src/cdp/locator-candidates.js';
import { BUILD_PAYLOAD_FN } from '../../src/cdp/inspect-payload-script.js';
import { buildResolveExpression } from '../../src/cdp/resolve-by-label.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// 1) PAGE_LOCATOR_HELPERS — shared dependency (imported: defines buildLocatorSnap,
//    absXPath, cleanVisibleText, normalizeTargetRoot, xpathSmartOf, …)
// ---------------------------------------------------------------------------
const HELPERS = PAGE_LOCATOR_HELPERS;

// ---------------------------------------------------------------------------
// 2) AI elMeta + its IIFE-local helpers (from inspect-payload-script.js
//    BUILD_PAYLOAD_FN — already-evaluated template literal).
//    elMeta uses: xpathOf, buXPathOf, attrs, shortLabel(→visibleText),
//    formItemLabel(→placeholderLabel), buildLocatorSnap (helpers).
// ---------------------------------------------------------------------------
// Helper block: from `function xpathOf(node)` up to (not including) `function elMeta`
const aiHelpersMatch = BUILD_PAYLOAD_FN.match(/  function xpathOf\(node\) \{[\s\S]*?\n  function elMeta/);
if (!aiHelpersMatch) throw new Error('AI helper block not found in inspect-payload-script.js');
const AI_HELPERS = aiHelpersMatch[0].replace(/\n  function elMeta$/, '');
// elMeta body (2-space indent closing brace)
const aiElMetaMatch = BUILD_PAYLOAD_FN.match(/  function elMeta\([^)]*\) \{[\s\S]*?\n  \}/);
if (!aiElMetaMatch) throw new Error('AI elMeta not found in inspect-payload-script.js');
const AI_ELMETA = aiElMetaMatch[0];

// ---------------------------------------------------------------------------
// 3) Manual elMeta (from b.py JS string) + helpers (from a.py).
//    b.py is a Python r'''...''' raw string — JS code is literal (no escape
//    processing), so regex extraction yields valid JS.
//    b.py elMeta uses: shortLabel, highlightIndexOf, buXPathOf, xpathOf,
//    formItemLabel(→placeholderLabel), attrs, buildLocatorSnap (helpers).
// ---------------------------------------------------------------------------
const aPy = readFileSync(path.join(root, 'scripts/manual_recorder/js_parts/a.py'), 'utf8');
// a.py helpers: from `function xpathOf(el)` through end of `function shortLabel(el) {…}`
const aHelpersMatch = aPy.match(/  function xpathOf\(el\) \{[\s\S]*?  function shortLabel\(el\) \{[\s\S]*?\n  \}/);
if (!aHelpersMatch) throw new Error('a.py helper block not found');
const A_HELPERS = aHelpersMatch[0];

const bPy = readFileSync(path.join(root, 'scripts/manual_recorder/js_parts/b.py'), 'utf8');
// b.py elMeta body (2-space indent closing brace)
const bElMetaMatch = bPy.match(/  function elMeta\([^)]*\) \{[\s\S]*?\n  \}/);
if (!bElMetaMatch) throw new Error('b.py elMeta not found');
const B_ELMETA = bElMetaMatch[0];

// ---------------------------------------------------------------------------
// 4) Auto-grab snap + its local helpers (from resolve-by-label.js
//    buildResolveExpression output — already-evaluated template literal).
//    snap uses: xpathOf(→absXPath), cleanVisibleText (helpers),
//    formItemLabel(→placeholderLabel), buildLocatorSnap (helpers).
// ---------------------------------------------------------------------------
const resolveExpr = buildResolveExpression({ labelText: 'x', actionType: '', params: {}, mode: 'needle' });
// Local helpers: placeholderLabel + formItemLabel + xpathOf (4-space indent)
const resolveHelpersMatch = resolveExpr.match(
  /    function placeholderLabel\(node\) \{[\s\S]*?    function xpathOf\(node\) \{[\s\S]*?\n    \}/,
);
if (!resolveHelpersMatch) throw new Error('resolve-by-label.js helper block not found');
const RESOLVE_HELPERS = resolveHelpersMatch[0];
// snap body (4-space indent closing brace)
const snapMatch = resolveExpr.match(/    function snap\([^)]*\) \{[\s\S]*?\n    \}/);
if (!snapMatch) throw new Error('resolve-by-label.js snap not found');
const SNAP = snapMatch[0];

// ---------------------------------------------------------------------------
// 5) Run: load fixture, inject helpers + three entry closures, assert equality.
// ---------------------------------------------------------------------------
async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const fixturePath = path.join(__dirname, 'fixtures/xpath-unify-fixture.html');
    await page.goto('file://' + fixturePath.replace(/\\/g, '/'));

    const results = await page.evaluate(
      ({ HELPERS, AI_HELPERS, AI_ELMETA, A_HELPERS, B_ELMETA, RESOLVE_HELPERS, SNAP }) => {
        // Inject PAGE_LOCATOR_HELPERS into global scope (indirect eval → global).
        (0, eval)(HELPERS);

        // AI entry: IIFE-scoped helpers + elMeta → return elMeta
        const ai = (0, eval)(
          '(function(){\n' + AI_HELPERS + '\n' + AI_ELMETA + '\nreturn elMeta;\n})()',
        );
        // Manual entry: a.py helpers + b.py elMeta → return elMeta
        const manual = (0, eval)(
          '(function(){\n' + A_HELPERS + '\n' + B_ELMETA + '\nreturn elMeta;\n})()',
        );
        // Auto entry: resolve-by-label local helpers + snap → return snap
        const snap = (0, eval)(
          '(function(){\n' + RESOLVE_HELPERS + '\n' + SNAP + '\nreturn snap;\n})()',
        );

        const out = [];
        const cases = [
          { sel: '[data-testid="cust-name"]', text: '客户名称', kind: 'form_input', asForm: true },
          { sel: '[data-testid="login-user"]', text: '请输入用户名', kind: 'form_input', asForm: true },
          { sel: '[data-testid="crop-select"]', text: '所属机构', kind: 'form_select', asForm: true },
          { sel: '[data-testid="radio-1"]', text: '对公', kind: 'form_radio', asForm: false },
          { sel: '[data-testid="dialog-input"]', text: '审批意见', kind: 'form_input', asForm: true },
          { sel: '[data-testid="dialog-close"]', text: 'close', kind: 'dialog_close', asForm: false },
          { sel: '[data-testid="save-1"]', text: '保存', kind: 'button', asForm: false },
          { sel: '[data-testid="save-2"]', text: '保存', kind: 'button', asForm: false },
          { sel: '[data-testid="tab-1"]', text: '基本信息', kind: 'tab', asForm: false },
        ];
        for (const c of cases) {
          const node = document.querySelector(c.sel);
          if (!node) throw new Error('fixture node not found: ' + c.sel);
          const r1 = ai(node, c.text, c.kind);
          const r2 = manual(node, c.text, c.kind, undefined);
          const r3 = snap(node, c.text, c.asForm, c.kind, undefined);
          out.push({ sel: c.sel, r1, r2, r3 });
        }
        return out;
      },
      { HELPERS, AI_HELPERS, AI_ELMETA, A_HELPERS, B_ELMETA, RESOLVE_HELPERS, SNAP },
    );

    const fields = ['xpath_smart', 'xpath_full', 'candidates', 'locator_strategy', 'target_kind'];
    let failures = 0;
    for (const { sel, r1, r2, r3 } of results) {
      for (const f of fields) {
        try {
          assert.deepStrictEqual(r2[f], r1[f], `${sel} ${f}: manual≠ai`);
        } catch (e) {
          failures++;
          console.error(`FAIL ${sel} [${f}] manual≠ai\n  ai    = ${JSON.stringify(r1[f])}\n  manual= ${JSON.stringify(r2[f])}`);
        }
        try {
          assert.deepStrictEqual(r3[f], r1[f], `${sel} ${f}: auto≠ai`);
        } catch (e) {
          failures++;
          console.error(`FAIL ${sel} [${f}] auto≠ai\n  ai   = ${JSON.stringify(r1[f])}\n  auto = ${JSON.stringify(r3[f])}`);
        }
      }
    }

    if (failures > 0) {
      console.error(`FAILED: ${failures} field mismatch(es) across ${results.length} nodes × ${fields.length} fields`);
      process.exit(1);
    }
    console.log(`OK: ${results.length} nodes × ${fields.length} fields consistent across 3 sources`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
