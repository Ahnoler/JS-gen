import assert from 'node:assert/strict';
import { prepareElementJson, hasUsableLocator } from '../src/models/element.js';
import { normalizeElementJson } from '../src/models/helpers.js';

const ok = prepareElementJson({
  element: {
    xpath_smart: "//button[normalize-space()='保存']",
    xpath_full: '/b[1]',
    locator_verified: true,
  },
  actionType: 'click_element_by_index',
  params: { text: '保存' },
  requireUsable: true,
});
assert.equal(ok.locator_strategy, 'xpath_smart');
assert.equal(ok.xpath, ok.xpath_smart);
assert.ok(hasUsableLocator(ok));
assert.equal(ok.locator_verified, true);

const abs = prepareElementJson({
  element: { xpath_full: '/div[1]/input[1]', text: '' },
  actionType: 'fill_form_field',
  params: { label_text: '' },
  requireUsable: true,
});
assert.equal(abs.locator_strategy, 'xpath_full');
assert.ok(abs.locator_fallback_reason);

let threw = false;
try {
  prepareElementJson({
    element: {},
    actionType: 'click_element_by_index',
    requireUsable: true,
  });
} catch (e) {
  threw = e.statusCode === 400;
}
assert.ok(threw);

const norm = normalizeElementJson({
  xpath_smart: "//li[normalize-space()='客户管理']",
  xpath_full: '/ul/li[1]',
  locator_strategy: 'xpath_smart',
  target_kind: 'menu',
  locator_scope: 'nav',
});
assert.equal(norm.target_kind, 'menu');
assert.equal(norm.locator_strategy, 'xpath_smart');

console.log('node-smoke-element-policy: OK');
