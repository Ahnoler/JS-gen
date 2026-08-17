/**
 * Characterization: system node POST/PUT accounts payload (offline).
 * Run: node scripts/characterization/characterize-system-node-accounts.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSystemAccounts } from '../../src/services/hierarchy-service.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function testNormalize() {
  const accounts = normalizeSystemAccounts([
    { name: ' 测试者 ', account: 701994, password: 1 },
    {
      name: '管理员',
      account: 'admin',
      password: 'p@ss',
      loginUrl: ' https://example.com/login ',
      remark: '权限：全部',
      sortOrder: '3',
    },
  ]);

  assert.equal(accounts[0].name, '测试者');
  assert.equal(accounts[0].account, '701994');
  assert.equal(accounts[0].password, '1');
  assert.equal(accounts[0].sortOrder, 0);

  assert.equal(accounts[1].account, 'admin');
  assert.equal(accounts[1].loginUrl, 'https://example.com/login');
  assert.equal(accounts[1].sortOrder, 3);

  assert.equal(normalizeSystemAccounts([]).length, 0);
}

function testValidation() {
  const invalid = [
    'not-array',
    [null],
    [{ name: '' }],
    [{ name: 'a' }, { name: 'A' }],
    [{ name: 'a', sortOrder: 'x' }],
    [{ id: 0, name: 'a' }],
    [{ id: -1, name: 'a' }],
  ];
  for (const payload of invalid) {
    assert.throws(() => normalizeSystemAccounts(payload), /accounts|name|sortOrder|id/);
  }
}

function testWiring() {
  const route = readFileSync(join(root, 'src/routes/v2/system-mgmt.js'), 'utf8');
  assert.match(route, /accounts: body\.accounts/);

  const service = readFileSync(join(root, 'src/services/hierarchy-service.js'), 'utf8');
  assert.match(service, /node\.accounts = await syncSystemAccounts/);
  assert.match(service, /getDB\(\)\.transaction/);
}

function testGetNodeEcho() {
  // GET /api/v2/system-mgmt/nodes/:id 详情必须回显系统账号（编辑表单回显前提）
  const service = readFileSync(join(root, 'src/services/hierarchy-service.js'), 'utf8');
  const m = service.match(/export async function getNode\(id\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'getNode present');
  assert.match(m[0], /NODE_TYPE\.SYSTEM/, 'only system nodes attach accounts');
  assert.match(m[0], /systemAccountDao\.listBySystem\(node\.id\)/, 'loads accounts by node id');
  assert.match(m[0], /node\.accounts = accounts\.map/, 'attaches accounts to node');
  assert.match(m[0], /password: a\.password \|\| ''/, 'same shape as tree includeAccounts');
}

function main() {
  console.log('\n=== system node accounts characterization ===\n');
  const tests = [
    ['normalize accounts', testNormalize],
    ['payload validation', testValidation],
    ['route/service wiring', testWiring],
    ['getNode detail echoes accounts', testGetNodeEcho],
  ];
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${name}:`, err.message);
    }
  }
  console.log(failed ? '\nFAIL' : '\nOK');
  process.exitCode = failed ? 1 : 0;
}

main();
