/**
 * Characterization: system node POST/PUT accounts payload (offline).
 * Run: node scripts/characterization/characterize-system-node-accounts.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeSystemAccounts,
  assertAccountNamesAvailable,
} from '../../src/services/hierarchy-service.js';
import {
  MASKED_PASSWORD,
  maskAccountPassword,
} from '../../src/dao/system-account-dao.js';

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

  // 哨兵在 normalize 层原样通过（写侧跳过由 syncSystemAccounts 处理）
  assert.equal(
    normalizeSystemAccounts([{ name: 'a', password: MASKED_PASSWORD }])[0].password,
    '******',
  );
  // 空密码语义不变：null/undefined → ''
  assert.equal(normalizeSystemAccounts([{ name: 'a' }])[0].password, '');
  assert.equal(normalizeSystemAccounts([{ name: 'a', password: null }])[0].password, '');

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
    assert.throws(() => normalizeSystemAccounts(payload), /accounts|name|sortOrder|id|重复/);
  }
}

function testDuplicateNameMessage() {
  try {
    normalizeSystemAccounts([{ name: 'a' }, { name: 'A' }]);
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.code, 'VALIDATION');
    assert.equal(err.message, '同一系统下角色名称不能重复：「A」');
  }
}

function testAssertNamesAvailable() {
  const existing = [
    { id: 12, name: '黄正祥' },
    { id: 15, name: '李淼一' },
  ];
  // 自身同名保留：通过
  assertAccountNamesAvailable(existing, [
    { targetId: 12, name: '黄正祥' },
    { targetId: 15, name: '李淼一' },
  ]);
  // 交叉对调：拒绝
  try {
    assertAccountNamesAvailable(existing, [
      { targetId: 12, name: '李淼一' },
      { targetId: 15, name: '黄正祥' },
    ]);
    assert.fail('expected swap reject');
  } catch (err) {
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /^角色名称「.+」已被占用。若要对调，请先将其中一条改为临时名称后再提交。$/);
  }
  // 新建占用已有名：拒绝
  try {
    assertAccountNamesAvailable(existing, [{ targetId: null, name: '李淼一' }]);
    assert.fail('expected create conflict');
  } catch (err) {
    assert.equal(err.code, 'VALIDATION');
    assert.equal(
      err.message,
      '角色名称「李淼一」已被占用。若要对调，请先将其中一条改为临时名称后再提交。',
    );
  }
  // 改成全新名：通过
  assertAccountNamesAvailable(existing, [
    { targetId: 12, name: '临时甲' },
    { targetId: 15, name: '李淼一' },
  ]);
}

function testWiring() {
  const route = readFileSync(join(root, 'src/routes/v2/system-mgmt.js'), 'utf8');
  assert.match(route, /accounts: body\.accounts/);

  const service = readFileSync(join(root, 'src/services/hierarchy-service.js'), 'utf8');
  assert.match(service, /node\.accounts = await syncSystemAccounts/);
  assert.match(service, /getDB\(\)\.transaction/);
}

function testSyncGuardsPinned() {
  const service = readFileSync(join(root, 'src/services/hierarchy-service.js'), 'utf8');
  assert.match(service, /assertAccountNamesAvailable\(/);
  assert.match(service, /ER_DUP_ENTRY|errno === 1062/);
  assert.match(
    service,
    /同一系统下角色名称「\$\{.*\}」已存在，请修改后再提交。若要对调两条账号，请先将其中一条改为临时名称/,
  );
  assert.match(service, /code: 'CONFLICT'/);
}

function testGetNodeEcho() {
  // GET /api/v2/system-mgmt/nodes/:id 详情必须回显系统账号（编辑表单回显前提），
  // 且 password 必须经 maskAccountPassword 掩码为哨兵（P0-3，不得明文出站）
  const service = readFileSync(join(root, 'src/services/hierarchy-service.js'), 'utf8');
  const m = service.match(/export async function getNode\(id\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'getNode present');
  assert.match(m[0], /NODE_TYPE\.SYSTEM/, 'only system nodes attach accounts');
  assert.match(m[0], /systemAccountDao\.listBySystem\(node\.id\)/, 'loads accounts by node id');
  assert.match(m[0], /node\.accounts = accounts\.map/, 'attaches accounts to node');
  assert.match(m[0], /maskAccountPassword\(\{/, 'getNode masks password (P0-3)');
  assert.match(
    m[0],
    /maskAccountPassword\(\{[\s\S]*?password: a\.password \|\| ''/,
    'plaintext row field only appears inside the mask call',
  );
}

function testMaskHelper() {
  // DAO helper 行为：非空 → 哨兵；空/NULL → 空；null 入参原样返回
  assert.equal(MASKED_PASSWORD, '******');
  assert.equal(maskAccountPassword({ id: 1, password: 'real' }).password, '******');
  assert.equal(maskAccountPassword({ id: 1, password: '' }).password, '');
  assert.equal(maskAccountPassword({ id: 1, password: null }).password, '');
  assert.equal(maskAccountPassword(null), null);
  // 浅拷贝：不改入参
  const src = { password: 'x' };
  maskAccountPassword(src);
  assert.equal(src.password, 'x');
}

function testTreeOutboundMask() {
  // tree 的 accounts 组装（includeAccounts）同样必须掩码出站
  const treeQuery = readFileSync(join(root, 'src/services/hierarchy-tree-query.js'), 'utf8');
  assert.match(treeQuery, /maskAccountPassword/, 'tree accounts mapping masks password');
  assert.match(
    treeQuery,
    /import \{ maskAccountPassword \} from '\.\.\/dao\/system-account-dao\.js';/,
    'mask helper imported from system-account-dao',
  );
  const accountsBlock = treeQuery.match(/node\.accounts = [\s\S]*?\}\)\);/);
  assert.ok(accountsBlock, 'tree accounts mapping present');
  assert.match(accountsBlock[0], /maskAccountPassword\(\{/);
}

function testSentinelWriteSkip() {
  // 写侧：syncSystemAccounts 遇 '******' 更新时跳过 password（保持库中原值），新建视为空密码
  const service = readFileSync(join(root, 'src/services/hierarchy-service.js'), 'utf8');
  const syncBlock = service.match(/async function syncSystemAccounts\([\s\S]*?\n\}/);
  assert.ok(syncBlock, 'syncSystemAccounts present');
  assert.match(syncBlock[0], /item\.password === MASKED_PASSWORD/, 'sentinel check on write side');
  assert.match(syncBlock[0], /if \(target\) delete data\.password/, 'update keeps stored password');
  assert.match(syncBlock[0], /data\.password = ''/, 'create with sentinel → empty password');
  // DAO 哨兵常量是唯一定义点
  const dao = readFileSync(join(root, 'src/dao/system-account-dao.js'), 'utf8');
  assert.match(dao, /export const MASKED_PASSWORD = '\*\*\*\*\*\*'/);
}

function main() {
  console.log('\n=== system node accounts characterization ===\n');
  const tests = [
    ['normalize accounts', testNormalize],
    ['payload validation', testValidation],
    ['duplicate name message', testDuplicateNameMessage],
    ['assert names available', testAssertNamesAvailable],
    ['sync guards pinned', testSyncGuardsPinned],
    ['route/service wiring', testWiring],
    ['getNode detail echoes accounts', testGetNodeEcho],
    ['mask helper (dao)', testMaskHelper],
    ['tree outbound mask', testTreeOutboundMask],
    ['sentinel write skip', testSentinelWriteSkip],
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
