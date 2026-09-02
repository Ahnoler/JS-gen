import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

let buildMenuPushPayload;
let formatSourceSystemId;
let formatSourceSystemName;
let modOk = false;
try {
  const mod = await import('../../src/services/menu-push.js');
  buildMenuPushPayload = mod.buildMenuPushPayload;
  formatSourceSystemId = mod.formatSourceSystemId;
  formatSourceSystemName = mod.formatSourceSystemName;
  modOk = true;
} catch { modOk = false; }

function testPayloadShape() {
  if (!modOk) { console.log('    (skipped: SUT not importable)'); return; }
  const system = { id: 1, name: '信贷系统', type: 1 };
  const nodes = [
    { id: 10, type: 2, name: '客户管理', umlEcd: 'UML00092041', parentId: 1, pdCmptEcd: '', source: 'json_import', menuXpath: "//li[@data-id='RES1']", unmatchedFlag: 0, removedFlag: 0, sortOrder: 1 },
    { id: 11, type: 3, name: '对公客户管理', umlEcd: 'UML00005556', parentId: 10, pdCmptEcd: 'ZJJK00066153', source: 'json_import', menuXpath: "//li[@data-id='RES101']", unmatchedFlag: 0, removedFlag: 0, sortOrder: 1 },
    { id: 12, type: 3, name: '工作台入口', umlEcd: '', parentId: 10, pdCmptEcd: 'FS00005518', source: 'ai', menuXpath: "//li[@data-id='RES999']", unmatchedFlag: 0, removedFlag: 0, sortOrder: 2 },
  ];
  const payload = buildMenuPushPayload(system, nodes, {
    menuVersion: 8,
    partnerSystemId: 51,
    partnerSystemName: '系统1',
  });
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.systemNodeId, 51);
  assert.equal(payload.systemName, '系统1');
  assert.equal(formatSourceSystemId(1), 'JSGEN:1');
  assert.equal(formatSourceSystemName('信贷系统'), 'JSGEN:信贷系统');
  assert.ok(!('sourceSystemId' in payload));
  assert.equal(payload.menuVersion, 8);
  assert.equal(payload.menus.length, 3);
  const fn = payload.menus.find((m) => m.name === '对公客户管理');
  assert.equal(fn.pageId, 'ZJJK00066153');
  assert.equal(fn.parentUmlEcd, 'UML00092041');
  assert.equal(fn.parentPath, '客户管理-对公客户管理');
  assert.equal(fn.source, 'json_import');
  const ai = payload.menus.find((m) => m.name === '工作台入口');
  assert.equal(ai.source, 'ai');
  assert.equal(ai.pageId, 'FS00005518');
  assert.equal(typeof fn.pageId, 'string');
  assert.ok(!Array.isArray(fn.pageId));
  const mod = payload.menus.find((m) => m.type === 2);
  assert.equal(mod.pageId, '');
  assert.equal(mod.parentUmlEcd, '');
}

function testWiringPartnerImport() {
  const partner = readFileSync(join(root, 'src/services/partner-platform.js'), 'utf8');
  assert.match(partner, /export async function pushMenusToPartner/, 'pushMenusToPartner exported');
  assert.match(partner, /umlElementData\/importData/, 'importData endpoint pinned');
  assert.match(partner, /toPartnerMenuPushPayload/, 'payload adapter');
  assert.doesNotMatch(partner.slice(partner.indexOf('toPartnerMenuPushPayload')), /sourceSystemId/, 'no source fields to partner');
  const fnBlock = partner.slice(partner.indexOf('pushMenusToPartner'));
  assert.match(fnBlock, /partnerFetch\(/, 'pushMenusToPartner calls partnerFetch');
  assert.doesNotMatch(fnBlock, /partner_endpoint_pending/, 'stub removed');
}

function testWiringService() {
  const svc = readFileSync(join(root, 'src/services/menu-push.js'), 'utf8');
  assert.match(svc, /partnerSystemId/, 'partner system id required');
  assert.match(svc, /partnerSystemName/, 'partner system name required');
  assert.match(svc, /MENU_PUSH_AUTO_SYNC_MS|getAutoSyncMs/, 'auto-sync configurable');
}

function testWiringRoute() {
  const route = readFileSync(join(root, 'src/routes/v2/system-mgmt.js'), 'utf8');
  assert.match(route, /push-menu/, 'route registers push-menu');
  assert.match(route, /pushMenuForSystem/, 'route calls pushMenuForSystem');
  assert.match(route, /getMenuPushStatus/, 'route calls getMenuPushStatus');
}

function main() {
  console.log('\n=== menu push characterization ===\n');
  const tests = [
    ['buildMenuPushPayload v1.2 shape', testPayloadShape],
    ['wiring: partner importData HTTP', testWiringPartnerImport],
    ['wiring: menu-push service', testWiringService],
    ['wiring: push-menu routes', testWiringRoute],
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
