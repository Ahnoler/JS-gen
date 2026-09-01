import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

let buildMenuPushPayload;
let modOk = false;
try {
  const mod = await import('../../src/services/menu-push.js');
  buildMenuPushPayload = mod.buildMenuPushPayload;
  modOk = true;
} catch { modOk = false; }

function testPayloadShape() {
  if (!modOk) { console.log('    (skipped: SUT not importable)'); return; }
  const system = { id: 1, name: '信贷系统', type: 1 };
  const nodes = [
    { id: 10, type: 2, name: '客户管理', umlEcd: 'UML00092041', parentId: 1, pdCmptEcd: '', source: 'json_import', menuXpath: "//li[@data-id='RES1']", unmatchedFlag: 0, removedFlag: 0, sortOrder: 1 },
    { id: 11, type: 3, name: '对公客户管理', umlEcd: 'UML00005556', parentId: 10, pdCmptEcd: 'ZJJK00066153', source: 'json_import', menuXpath: "//li[@data-id='RES101']", unmatchedFlag: 0, removedFlag: 0, sortOrder: 1 },
  ];
  const payload = buildMenuPushPayload(system, nodes, { menuVersion: 8 });
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.systemNodeId, 1);
  assert.equal(payload.menuVersion, 8);
  assert.equal(payload.menus.length, 2);
  const fn = payload.menus.find((m) => m.name === '对公客户管理');
  assert.equal(fn.pageId, 'ZJJK00066153');
  assert.equal(fn.parentUmlEcd, 'UML00092041');
  assert.equal(fn.parentPath, '客户管理-对公客户管理');
  assert.equal(fn.source, 'json_import');
  assert.equal(typeof fn.pageId, 'string');
  assert.ok(!Array.isArray(fn.pageId));
  const mod = payload.menus.find((m) => m.type === 2);
  assert.equal(mod.pageId, '');
  assert.equal(mod.parentUmlEcd, '');
}

function testWiringStub() {
  const partner = readFileSync(join(root, 'src/services/partner-platform.js'), 'utf8');
  assert.match(partner, /export async function pushMenusToPartner/, 'stub exported');
  assert.match(partner, /partner_endpoint_pending/, 'stub reason pinned');
  assert.doesNotMatch(
    partner.slice(partner.indexOf('pushMenusToPartner')),
    /partnerFetch\(/,
    'pushMenusToPartner must not call partnerFetch',
  );
}

function testWiringService() {
  const svc = readFileSync(join(root, 'src/services/menu-push.js'), 'utf8');
  assert.match(svc, /pushMenusToPartner/, 'service calls stub');
  assert.match(svc, /MENU_PUSH_AUTO_SYNC_MS|getAutoSyncMs/, 'auto-sync configurable');
}

function main() {
  console.log('\n=== menu push characterization ===\n');
  const tests = [
    ['buildMenuPushPayload v1.2 shape', testPayloadShape],
    ['wiring: partner stub pending', testWiringStub],
    ['wiring: menu-push service', testWiringService],
  ];
  let failed = 0;
  for (const [name, fn] of tests) {
    try { fn(); console.log(`  ✓ ${name}`); }
    catch (e) { failed += 1; console.error(`  ✗ ${name}:`, e.message); }
  }
  console.log(failed ? '\nFAIL' : '\nOK');
  process.exitCode = failed ? 1 : 0;
}
main();
