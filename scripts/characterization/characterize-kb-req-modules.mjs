/**
 * Characterization: kb-req-modules workspace service (offline, temp rootDir).
 *
 * Run:
 *   node scripts/characterization/characterize-kb-req-modules.mjs
 */
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
  statSync,
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
  const svc = await import(pathToFileURL(join(ROOT, 'src/services/kb-req-modules.js')).href);
  const dir = mkdtempSync(join(tmpdir(), 'kb-req-'));
  const flowsSentinelDir = mkdtempSync(join(tmpdir(), 'kb-flows-sentinel-'));
  const sentinelFile = join(flowsSentinelDir, 'sentinel.txt');
  writeFileSync(sentinelFile, 'unchanged');

  try {
    run('reject bad moduleKey Bad_Key', () => {
      assert.throws(() => svc.assertModuleKey('Bad_Key'), /moduleKey/);
    });

    run('reject bad moduleKey Foo', () => {
      assert.throws(() => svc.assertModuleKey('Foo'), /moduleKey/);
    });

    run('accept product-mgmt moduleKey', () => {
      svc.assertModuleKey('product-mgmt');
    });

    await runAsync('register creates dirs and manifest files', async () => {
      const manifest = await svc.registerReqModule({
        rootDir: dir,
        moduleKey: 'product-mgmt',
        moduleName: '产品管理',
        sourcePath: 'C:/nonexistent/demo.docx',
      });
      const modDir = join(dir, 'product-mgmt');
      assert.equal(manifest.moduleKey, 'product-mgmt');
      assert.equal(manifest.moduleName, '产品管理');
      assert.equal(manifest.sourceKind, 'req');
      assert.equal(manifest.status, 'registered');
      assert.ok(Array.isArray(manifest.warnings));
      assert.ok(manifest.warnings.includes('sourcePath not accessible from server'));
      assert.ok(existsSync(join(modDir, 'manifest.json')));
      assert.ok(existsSync(join(modDir, 'source.link.json')));
      assert.ok(existsSync(join(modDir, 'chapters')));
      assert.ok(existsSync(join(modDir, 'drafts')));
      const link = JSON.parse(readFileSync(join(modDir, 'source.link.json'), 'utf8'));
      assert.equal(link.sourcePath, 'C:/nonexistent/demo.docx');
      assert.equal(link.sourceKind, 'req');
    });

    await runAsync('idempotent register preserves chapters', async () => {
      const modDir = join(dir, 'product-mgmt');
      const chapterFile = join(modDir, 'chapters', 'a.md');
      writeFileSync(chapterFile, '# chapter a');
      await svc.registerReqModule({
        rootDir: dir,
        moduleKey: 'product-mgmt',
        moduleName: '产品管理 v2',
        sourcePath: 'C:/another/path.docx',
      });
      assert.ok(existsSync(chapterFile));
      assert.equal(readFileSync(chapterFile, 'utf8'), '# chapter a');
      const manifest = JSON.parse(readFileSync(join(modDir, 'manifest.json'), 'utf8'));
      assert.equal(manifest.moduleName, '产品管理 v2');
      assert.equal(manifest.sourcePath, 'C:/another/path.docx');
    });

    await runAsync('reset clears chapters but keeps manifest', async () => {
      const modDir = join(dir, 'product-mgmt');
      assert.ok(existsSync(join(modDir, 'chapters', 'a.md')));
      await svc.registerReqModule({
        rootDir: dir,
        moduleKey: 'product-mgmt',
        moduleName: '产品管理 v2',
        sourcePath: 'C:/another/path.docx',
        reset: true,
      });
      assert.ok(!existsSync(join(modDir, 'chapters', 'a.md')));
      assert.ok(existsSync(join(modDir, 'chapters')));
      const manifest = JSON.parse(readFileSync(join(modDir, 'manifest.json'), 'utf8'));
      assert.equal(manifest.status, 'registered');
    });

    await runAsync('list includes registered module', async () => {
      const rows = await svc.listReqModules({ rootDir: dir });
      assert.ok(rows.some((r) => r.moduleKey === 'product-mgmt'));
    });

    await runAsync('get returns detail probe fields', async () => {
      const modDir = join(dir, 'product-mgmt');
      writeFileSync(join(modDir, 'chapters', 'b.md'), '# b');
      writeFileSync(join(modDir, 'through-chains.md'), '# chains');
      writeFileSync(join(modDir, 'drafts', 'flow-a.json'), '{}');
      const detail = await svc.getReqModule({ rootDir: dir, moduleKey: 'product-mgmt' });
      assert.equal(detail.moduleKey, 'product-mgmt');
      assert.equal(detail.hasChapters, true);
      assert.equal(detail.hasThroughChains, true);
      assert.equal(detail.draftCount, 1);
    });

    await runAsync('get missing module throws NOT_FOUND', async () => {
      await assert.rejects(
        () => svc.getReqModule({ rootDir: dir, moduleKey: 'missing-module' }),
        (err) => err.code === 'NOT_FOUND',
      );
    });

    await runAsync('register does not touch flows sentinel outside rootDir', async () => {
      const before = statSync(sentinelFile);
      const beforeContent = readFileSync(sentinelFile, 'utf8');
      await svc.registerReqModule({
        rootDir: dir,
        moduleKey: 'sentinel-check',
        moduleName: '哨兵检查',
        sourcePath: 'C:/nonexistent/sentinel.docx',
      });
      const after = statSync(sentinelFile);
      const afterContent = readFileSync(sentinelFile, 'utf8');
      assert.equal(afterContent, beforeContent);
      assert.equal(after.mtimeMs, before.mtimeMs);
      assert.ok(!existsSync(join(flowsSentinelDir, 'sentinel-check')));
      assert.ok(existsSync(join(dir, 'sentinel-check', 'manifest.json')));
    });

    run('moduleDir resolves under injected rootDir', () => {
      const p = svc.moduleDir('product-mgmt', dir);
      assert.equal(p, join(dir, 'product-mgmt'));
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(flowsSentinelDir, { recursive: true, force: true });
  }

  console.log(`OK ${passed}`);
}

main();
