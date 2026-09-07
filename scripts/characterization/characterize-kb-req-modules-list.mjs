/**
 * Characterization: listReqModules includes hasThroughChains + canProposeAtoms
 * (draft wizard gates — file exists vs parseable step tables).
 *
 * Run:
 *   node scripts/characterization/characterize-kb-req-modules-list.mjs
 */
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let passed = 0;

function run(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n${e.message}`);
    throw e;
  }
}

async function runAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n${e.message}`);
    throw e;
  }
}

/** Minimal through-chains.md with a ### heading + step table (proposeable). */
const PROPOSEABLE_MD = `# chains

### 主链 A：示例闭环

| # | 步骤 | 页面/弹窗 | ZJJK | 关键按钮 |
|---|------|-----------|------|----------|
| 1 | 进入主页 | 主页 | ZJJK1 | 【进入】 |
`;

/** File exists but prose-only lists — no table steps → canProposeAtoms=false. */
const PROSE_ONLY_MD = `# chains

## 主链 1：示例

- **有序步骤**：
  1. 进入页面
  2. 点按钮
`;

async function main() {
  const svcPath = join(ROOT, 'src/services/kb-req-modules.js');
  const svcSrc = readFileSync(svcPath, 'utf-8');

  run('listReqModules source pins canProposeAtoms via hasProposeableChainSteps', () => {
    assert.match(svcSrc, /hasProposeableChainSteps/);
    assert.match(svcSrc, /canProposeAtoms/);
  });

  const docsSrc = readFileSync(join(ROOT, 'src/dashboard/api-docs/groups/kb.js'), 'utf-8');
  run('api-docs GET list example includes canProposeAtoms', () => {
    assert.match(docsSrc, /method:\s*'GET',\s*path:\s*'\/api\/v2\/kb\/req-modules'/);
    assert.match(docsSrc, /hasThroughChains:\s*true/);
    assert.match(docsSrc, /canProposeAtoms:\s*true/);
  });

  const svc = await import(pathToFileURL(svcPath).href);
  const dir = mkdtempSync(join(tmpdir(), 'kb-req-list-'));

  try {
    const proposeableDir = join(dir, 'proposeable');
    mkdirSync(proposeableDir, { recursive: true });
    writeFileSync(
      join(proposeableDir, 'manifest.json'),
      `${JSON.stringify({
        moduleKey: 'proposeable',
        moduleName: '可 propose',
        sourcePath: 'C:/docs/proposeable.docx',
        sourceKind: 'req',
        status: 'registered',
        warnings: [],
        createdAt: '2026-09-05T10:00:00.000Z',
        updatedAt: '2026-09-05T10:00:00.000Z',
      }, null, 2)}\n`,
    );
    writeFileSync(join(proposeableDir, 'through-chains.md'), PROPOSEABLE_MD);

    const proseDir = join(dir, 'prose-only');
    mkdirSync(proseDir, { recursive: true });
    writeFileSync(
      join(proseDir, 'manifest.json'),
      `${JSON.stringify({
        moduleKey: 'prose-only',
        moduleName: '仅散文主链',
        sourcePath: 'C:/docs/prose.docx',
        sourceKind: 'req',
        status: 'registered',
        warnings: [],
        createdAt: '2026-09-05T10:00:00.000Z',
        updatedAt: '2026-09-05T10:00:00.000Z',
      }, null, 2)}\n`,
    );
    writeFileSync(join(proseDir, 'through-chains.md'), PROSE_ONLY_MD);

    const noChainsDir = join(dir, 'no-chains');
    mkdirSync(noChainsDir, { recursive: true });
    writeFileSync(
      join(noChainsDir, 'manifest.json'),
      `${JSON.stringify({
        moduleKey: 'no-chains',
        moduleName: '无贯穿链',
        sourcePath: 'C:/docs/no-chains.docx',
        sourceKind: 'req',
        status: 'registered',
        warnings: [],
        createdAt: '2026-09-05T10:00:00.000Z',
        updatedAt: '2026-09-05T10:00:00.000Z',
      }, null, 2)}\n`,
    );

    await runAsync('listReqModules returns hasThroughChains + canProposeAtoms', async () => {
      const rows = await svc.listReqModules({ rootDir: dir });
      const proposeable = rows.find((r) => r.moduleKey === 'proposeable');
      const proseOnly = rows.find((r) => r.moduleKey === 'prose-only');
      const noChains = rows.find((r) => r.moduleKey === 'no-chains');
      assert.ok(proposeable);
      assert.ok(proseOnly);
      assert.ok(noChains);
      assert.equal(proposeable.hasThroughChains, true);
      assert.equal(proposeable.canProposeAtoms, true);
      assert.equal(proseOnly.hasThroughChains, true);
      assert.equal(proseOnly.canProposeAtoms, false);
      assert.equal(noChains.hasThroughChains, false);
      assert.equal(noChains.canProposeAtoms, false);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`OK ${passed}`);
}

main();
