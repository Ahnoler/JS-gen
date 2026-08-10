/**
 * Characterize resolve-element auto-grab (action-aware + verified xpath_smart).
 *
 *   node scripts/characterization/characterize-resolve-element-auto-grab.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildResolveExpression,
  filterVerifiedRelativeMatches,
  SUPPORTED_RESOLVE_ACTIONS,
} from '../../src/cdp/resolve-by-label.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../src/cdp/resolve-by-label.js'), 'utf8');

function ok(name) {
  console.log(`ok: ${name}`);
}

{
  assert.deepEqual(
    [...SUPPORTED_RESOLVE_ACTIONS].sort(),
    ['click_element_by_index', 'fill_form_field', 'select_option'].sort(),
  );
  ok('SUPPORTED_RESOLVE_ACTIONS');
}

{
  const fill = buildResolveExpression({
    labelText: '瀹㈡埛鍚嶇О',
    actionType: 'fill_form_field',
    params: { label_text: '瀹㈡埛鍚嶇О' },
  });
  assert.match(fill, /el-form-item/);
  assert.match(fill, /fill_form_field/);
  // PAGE_LOCATOR_HELPERS may mention menu-item tokens; assert form early-return instead
  assert.match(fill, /action === 'fill_form_field'|actionType === 'fill_form_field'/);
  assert.match(fill, /return out/);
  ok('fill expression scopes to form');
}

{
  const sel = buildResolveExpression({
    labelText: '甯佺',
    actionType: 'select_option',
    params: { label_text: '甯佺', option_text: '浜烘皯甯?' },
  });
  assert.match(sel, /el-form-item/);
  assert.match(sel, /el-select|form_select/);
  ok('select expression scopes to form');
}

{
  const click = buildResolveExpression({
    labelText: '瀵瑰叕瀹㈡埛绠＄悊',
    actionType: 'click_element_by_index',
    params: { text: '瀵瑰叕瀹㈡埛绠＄悊', index: -1 },
  });
  assert.match(click, /\.menu-item|\.el-menu-item/);
  assert.match(click, /button|\.el-button/);
  assert.match(click, /click_element_by_index/);
  ok('click expression includes menu + buttons');
}

{
  const usable = filterVerifiedRelativeMatches([
    {
      matchedLabel: 'A',
      element: {
        xpath: '//x',
        xpath_smart: '//x',
        locator_verified: true,
        locator_strategy: 'xpath_smart',
      },
      preview: { xpath_smart: '//x' },
    },
    {
      matchedLabel: 'B',
      element: {
        xpath: '/html/1',
        xpath_smart: '',
        locator_verified: false,
        locator_strategy: 'xpath_full',
      },
      preview: { xpath_smart: '' },
    },
  ]);
  assert.equal(usable.length, 1);
  assert.equal(usable[0].matchedLabel, 'A');
  assert.equal(usable[0].element.xpath, '//x');
  ok('filter keeps only verified xpath_smart');
}

{
  assert.match(SRC, /SUPPORTED_RESOLVE_ACTIONS|unsupported|out-of-scope|not supported/i);
  assert.match(SRC, /无可用相对定位.*xpath_smart/);
  ok('source mentions unsupported action + relative xpath failure copy');
}

console.log('characterize-resolve-element-auto-grab: PASS');
