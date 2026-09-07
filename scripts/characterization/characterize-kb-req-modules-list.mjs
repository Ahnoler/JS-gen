/**
 * Characterization: listReqModules includes hasThroughChains (draft wizard gate).
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

async function main() {
  const svcPath = join(ROOT, 'src/services/kb-req-modules.js');
  const svcSrc = readFileSync(svcPath, 'utf-8');

  run('listReqModules source pins hasThroughChains', () => {
    assert.match(svcSrc, /hasThroughChains:\s*await pathExists\(join\(root, ent\.name, 'through-chains\.md'\)\)/);
  });

  const docsSrc = readFileSync(join(ROOT, 'src/dashboard/api-docs/groups/kb.js'), 'utf-8');
  run('api-docs GET list example includes hasThroughChains', () => {
    assert.match(docsSrc, /method:\s*'GET',\s*path:\s*'\/api\/v2\/kb\/req-modules'/);
    assert.match(docsSrc, /hasThroughChains:\s*true/);
  });

  const svc = await import(pathToFileURL(svcPath).href);
  const dir = mkdtempSync(join(tmpdir(), 'kb-req-list-'));

  try {
    const modDir = join(dir, 'with-chains');
    mkdirSync(modDir, { recursive: true });
    writeFileSync(
      join(modDir, 'manifest.json'),
      `${JSON.stringify({
        moduleKey: 'with-chains',
        moduleName: '有贯穿链',
        sourcePath: 'C:/docs/with-chains.docx',
        sourceKind: 'req',
        status: 'registered',
        warnings: [],
        createdAt: '2026-09-05T10:00:00.000Z',
        updatedAt: '2026-09-05T10:00:00.000Z',
      }, null, 2)}\n`,
    );
    writeFileSync(join(modDir, 'through-chains.md'), '# chains');

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

    await runAsync('listReqModules returns hasThroughChains per row', async () => {
      const rows = await svc.listReqModules({ rootDir: dir });
      const withChains = rows.find((r) => r.moduleKey === 'with-chains');
      const noChains = rows.find((r) => r.moduleKey === 'no-chains');
      assert.ok(withChains);
      assert.ok(noChains);
      assert.equal(withChains.hasThroughChains, true);
      assert.equal(noChains.hasThroughChains, false);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`OK ${passed}`);
}

main();
