/**
 * Characterize resolve-element sidebar match (root cause: labelText-only never searched menus).
 *
 *   node scripts/characterization/characterize-resolve-element-auto-grab.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildResolveExpression } from '../../src/cdp/resolve-by-label.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../src/cdp/resolve-by-label.js'), 'utf8');

function ok(name) {
  console.log(`ok: ${name}`);
}

function sliceAfter(src, marker, len = 2500) {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, `missing marker: ${marker}`);
  return src.slice(i, i + len);
}

{
  // Dedicated click action must search sidebar menus (not only helpers elsewhere)
  assert.match(SRC, /action === 'click_element_by_index'/);
  const clickBlock = sliceAfter(SRC, "action === 'click_element_by_index'", 2000);
  assert.match(clickBlock, /\.menu-item/);
  assert.match(clickBlock, /\.el-menu-item/);
  ok('source: click_element_by_index searches menu nodes');
}

{
  // Defense for confirmed production payload { labelText only }:
  // generic clickables querySelectorAll must include menu selectors
  const gen = sliceAfter(SRC, 'Generic clickables', 900);
  assert.match(gen, /querySelectorAll/);
  assert.match(gen, /\.menu-item/);
  assert.match(gen, /\.el-menu-item/);
  ok('source: generic clickables include sidebar menus');
}

{
  // fill/select must early-return after form match (not fall into generic clickables)
  assert.match(SRC, /action === 'fill_form_field'/);
  assert.match(SRC, /action === 'select_option'/);
  const fillBlock = sliceAfter(SRC, "action === 'fill_form_field'", 3500);
  assert.match(fillBlock, /return out/);
  ok('source: fill_form_field early-returns');
}

{
  const expr = buildResolveExpression({
    labelText: '对公客户管理',
    actionType: 'click_element_by_index',
    params: { text: '对公客户管理', index: -1 },
  });
  assert.match(expr, /click_element_by_index/);
  // Expression body should contain the click branch menu selector list
  assert.match(expr, /\.menu-item, \.submenu-item, \.el-menu-item/);
  ok('expression: click_element_by_index embeds menu selector list');
}

console.log('characterize-resolve-element-auto-grab: PASS');
