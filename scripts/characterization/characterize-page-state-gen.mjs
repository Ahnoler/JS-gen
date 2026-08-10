/**
 * Characterize page-state-gen (collision-only clickable anchors).
 *   node scripts/characterization/characterize-page-state-gen.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const helpers = readFileSync(join(root, 'src/cdp/page-locator-helpers.js'), 'utf8');
function ok(n) { console.log(`ok: ${n}`); }

{
  assert.match(helpers, /function pageStateOf\s*\(/);
  assert.match(helpers, /el-dialog|el-drawer/);
  assert.match(helpers, /kind:\s*['"]dialog['"]|kind === ['"]dialog['"]|wizard_step/);
  assert.match(helpers, /pageStateAnchorXPath|pageStateNavXPath/);
  ok('helpers: pageStateOf includes dialog/drawer kinds');
}

{
  // Wrap not gated only on 下一步/上一步 — look for collision-driven page-state try
  assert.match(helpers, /pageStateOf\s*\(/);
  // After generalization, wrap should run when multi-hit, not only isWizardNavLabel
  assert.match(helpers, /tryPageStateAnchor/);
  assert.match(helpers, /PAGE_STATE_GEN/);
  assert.match(
    helpers,
    /function pageStateOf[\s\S]{0,900}el-dialog__title|el-drawer__title/,
  );
  ok('helpers: page-state wrap on collision path');
}

{
  // Unique form fields must not be forced through page-state wrap gate for form_*
  assert.match(helpers, /form_/);
  ok('helpers: form_* still present (no-force-wrap cue)');
}

console.log('characterize-page-state-gen: ok');
