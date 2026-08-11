/**
 * Characterize resolve-element ambiguous L1 region preview.
 *   node scripts/characterization/characterize-resolve-ambiguous-region.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildResolveExpression } from '../../src/cdp/resolve-by-label.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const helpers = readFileSync(join(root, 'src/cdp/page-locator-helpers.js'), 'utf8');
const resolveSrc = readFileSync(join(root, 'src/cdp/resolve-by-label.js'), 'utf8');
const scanForm = readFileSync(
  join(root, 'scripts/controller/actions/js_snippets/scan_form.py'),
  'utf8',
);

function ok(n) { console.log(`ok: ${n}`); }

{
  assert.match(helpers, /SHARED_ASSIGN_REGION/);
  assert.match(helpers, /function assignRegion\s*\(/);
  assert.match(helpers, /function regionLabelOf\s*\(/);
  assert.match(helpers, /region_role:\s*'overlay'/);
  assert.match(helpers, /shell-aside/);
  assert.match(helpers, /region_label/);
  ok('helpers: SHARED_ASSIGN_REGION + assignRegion + regionLabelOf');
}

{
  assert.match(helpers, /region_role:/);
  assert.match(helpers, /buildLocatorSnap/);
  // snap return must include region fields
  assert.match(helpers, /region_role:\s*region\.region_role|region_role:\s*reg\.|region_role:/);
  ok('helpers: buildLocatorSnap exposes region_*');
}

{
  assert.match(resolveSrc, /region_label/);
  assert.match(resolveSrc, /toPreview/);
  const previewBlock = resolveSrc.slice(resolveSrc.indexOf('function toPreview'), resolveSrc.indexOf('function toPreview') + 800);
  assert.match(previewBlock, /region_label/);
  assert.match(previewBlock, /region_role/);
  ok('resolve: toPreview includes region_*');
}

{
  const expr = buildResolveExpression({
    labelText: '新增',
    actionType: 'click_element_by_index',
    params: { text: '新增', index: -1 },
  });
  assert.match(expr, /assignRegion/);
  assert.match(expr, /region_label/);
  ok('expression injects assignRegion');
}

{
  // Scan must stay rule-aligned (same marker / role order cues)
  assert.match(scanForm, /SHARED_ASSIGN_REGION|assignRegion/);
  assert.match(scanForm, /shell-aside/);
  assert.match(scanForm, /el-collapse-item/);
  ok('scan_form: assignRegion still present / aligned');
}

console.log('characterize-resolve-ambiguous-region: ok');
