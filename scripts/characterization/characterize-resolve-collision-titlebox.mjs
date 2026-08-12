/**
 * Characterize collision-driven titlebox L1 refine for ambiguous resolve.
 *   node scripts/characterization/characterize-resolve-collision-titlebox.mjs
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
  assert.match(helpers, /COLLISION_REFINE|SHARED_COLLISION_REFINE/);
  assert.match(helpers, /function findTitleboxRegion\s*\(/);
  assert.match(helpers, /function titleboxAnchorXPath\s*\(/);
  assert.match(helpers, /function refineCollidingRegions\s*\(/);
  assert.match(helpers, /\.titlebox/);
  assert.match(helpers, /span\.title|querySelector\(['\"]span\.title/);
  ok('helpers: collision refine + titlebox APIs');
}

{
  assert.match(helpers, /regionOverride|region_override|opts\.region/);
  ok('helpers: buildLocatorSnap accepts region override');
}

{
  assert.match(resolveSrc, /COLLISION_REFINE|refineCollidingRegions/);
  assert.match(resolveSrc, /findTitleboxRegion|refineColliding/);
  ok('resolve: wires collision refine');
}

{
  // Contract: coarse assignRegion first, refine only on region_id collision (≥2).
  assert.match(helpers, /function refineCollidingRegions\s*\(/);
  assert.match(helpers, /idxs\.length < 2/);
  assert.match(helpers, /findTitleboxRegion/);
  const life = readFileSync(join(root, 'src/services/trajectory/trajectory-record-lifecycle.js'), 'utf8');
  assert.match(life, /keepPrevLabel|collision-refine|titlebox refine/);
  ok('contract: coarse then collision-refine; L1c must not clobber refine labels');
}

{
  const expr = buildResolveExpression({
    labelText: '新增',
    actionType: 'click_element_by_index',
    params: { text: '新增', index: -1 },
  });
  assert.match(expr, /refineCollidingRegions|findTitleboxRegion/);
  assert.match(expr, /titlebox/);
  ok('expression injects collision refine');
}

console.log('characterize-resolve-collision-titlebox: ok');
