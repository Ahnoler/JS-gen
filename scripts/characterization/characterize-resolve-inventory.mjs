/**
 * Characterize resolve-element mode=inventory (AG-fullpage).
 *   node scripts/characterization/characterize-resolve-inventory.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildResolveExpression } from '../../src/cdp/resolve-by-label.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const helpers = readFileSync(join(root, 'src/cdp/page-locator-helpers.js'), 'utf8');
const resolveSrc = readFileSync(join(root, 'src/cdp/resolve-by-label.js'), 'utf8');

function ok(n) { console.log(`ok: ${n}`); }

{
  assert.match(helpers, /SHARED_INVENTORY_COLLECT|INVENTORY_COLLECT/);
  assert.match(helpers, /function collectInventoryHosts\s*\(/);
  assert.match(helpers, /INVENTORY_CAP\s*=\s*120|inventoryCap\s*=\s*120/);
  assert.match(helpers, /INVENTORY_COLLECT_LIMIT\s*=\s*2000/);
  assert.doesNotMatch(helpers, /if\s*\(\s*out\.length\s*>=\s*INVENTORY_CAP\s*\)\s*break/);
  ok('helpers: inventory collect uncapped + filter-then-slice cap');
}

{
  assert.match(resolveSrc, /mode\s*===\s*['\"]inventory['\"]|opts\.mode|mode === \"inventory\"/);
  assert.match(resolveSrc, /forceAmbiguous|alwaysAmbiguous|!labelText/);
  assert.match(resolveSrc, /inv\.slice\s*\(\s*0\s*,\s*INVENTORY_CAP\s*\)/);
  assert.match(resolveSrc, /return\s*\{\s*matches:\s*out\s*,\s*truncated/);
  assert.match(resolveSrc, /value\.matches|pageTruncated/);
  const expr = buildResolveExpression({
    labelText: '',
    actionType: 'click_element_by_index',
    params: {},
    mode: 'inventory',
  });
  assert.match(expr, /inventory|collectInventoryHosts/);
  assert.match(expr, /slice\s*\(\s*0\s*,\s*INVENTORY_CAP\s*\)/);
  ok('resolve: inventory mode filter-then-slice + truncated object');
}

{
  const needle = buildResolveExpression({
    labelText: '客户名称',
    actionType: 'fill_form_field',
    params: { label_text: '客户名称' },
    mode: 'needle',
  });
  assert.ok(needle.length > 100);
  ok('resolve: needle mode still builds expression');
}

console.log('characterize-resolve-inventory: ok');
