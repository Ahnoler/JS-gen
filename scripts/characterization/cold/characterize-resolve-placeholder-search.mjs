/**
 * Characterize resolve-element placeholder-only search (sidebar「搜索关键字」).
 * Bare inputs outside `.el-form-item` must appear in inventory and needle fill_form_field.
 *
 *   node scripts/characterization/cold/characterize-resolve-placeholder-search.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildResolveExpression } from '../../../src/cdp/resolve-by-label.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const helpers = readFileSync(join(root, 'src/cdp/page-locator-helpers.js'), 'utf8');
const resolveSrc = readFileSync(join(root, 'src/cdp/resolve-by-label.js'), 'utf8');

function ok(n) { console.log(`ok: ${n}`); }

function sliceCollectL2Hosts(src) {
  const parts = src.split('function collectL2Hosts');
  assert.ok(parts.length > 1, 'missing collectL2Hosts');
  return parts[1].split('function collectInventoryHosts')[0];
}

function sliceFillSelectBlock(src) {
  const start = src.indexOf("action === 'fill_form_field'");
  assert.ok(start >= 0, 'missing fill_form_field block');
  const end = src.indexOf("action === 'click_element_by_index'", start);
  assert.ok(end > start, 'missing click_element_by_index after fill_form_field');
  return src.slice(start, end);
}

{
  const block = sliceCollectL2Hosts(helpers);
  const selMatch = block.match(/const sel = \[([\s\S]*?)\]\.join/);
  assert.ok(selMatch, 'collectL2Hosts must define const sel = [...].join');
  const selLines = selMatch[1].split('\n').map((l) => l.trim()).filter(Boolean);
  const bareInputLine = selLines.find(
    (line) => /input:not\(\[type="hidden"\]\)/.test(line) && !/\.el-form-item/.test(line),
  );
  assert.ok(
    bareInputLine,
    'collectL2Hosts must query bare input:not([type="hidden"]) outside .el-form-item (placeholder-only sidebar search)',
  );
  ok('helpers: collectL2Hosts admits bare placeholder inputs');
}

{
  const block = sliceFillSelectBlock(resolveSrc);
  assert.match(block, /\.el-form-item/);
  assert.match(block, /return out/);
  assert.match(
    block,
    /placeholderLabel\s*\(|getAttribute\s*\(\s*['"]placeholder['"]\s*\)/,
    'fill_form_field needle must fall back to placeholder matching after .el-form-item loop',
  );
  assert.match(
    block,
    /input:not\(\[type="hidden"\]\)|textarea/,
    'fill_form_field placeholder fallback must query bare input/textarea hosts',
  );
  ok('resolve: fill_form_field placeholder fallback after form-item loop');
}

{
  const inv = buildResolveExpression({
    labelText: '',
    actionType: 'fill_form_field',
    params: {},
    mode: 'inventory',
  });
  assert.match(inv, /collectL2Hosts|collectInventoryHosts/);
  const invCollect = sliceCollectL2Hosts(inv);
  const invSelMatch = invCollect.match(/const sel = \[([\s\S]*?)\]\.join/);
  assert.ok(invSelMatch, 'inventory expression must embed collectL2Hosts sel list');
  const invBare = invSelMatch[1].split('\n').map((l) => l.trim()).filter(Boolean)
    .find((line) => /input:not\(\[type="hidden"\]\)/.test(line) && !/\.el-form-item/.test(line));
  assert.ok(invBare, 'inventory expression must embed bare input:not([type="hidden"]) selector');
  ok('expression: inventory mode embeds bare input collection');
}

{
  const needle = buildResolveExpression({
    labelText: '搜索关键字',
    actionType: 'fill_form_field',
    params: { label_text: '搜索关键字' },
    mode: 'needle',
  });
  assert.match(needle, /fill_form_field/);
  const needleFill = sliceFillSelectBlock(needle);
  assert.match(
    needleFill,
    /placeholderLabel\s*\(|getAttribute\s*\(\s*['"]placeholder['"]\s*\)/,
    'needle expression fill_form_field must include placeholder fallback',
  );
  ok('expression: needle fill_form_field embeds placeholder fallback');
}

console.log('characterize-resolve-placeholder-search: ok');
