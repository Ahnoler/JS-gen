/**
 * Characterization: req→draft-traj (DAO + parse/provenance helpers).
 *
 * Run:
 *   node scripts/characterization/characterize-req-draft-traj.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  const dao = await import(pathToFileURL(join(ROOT, 'src/dao/trajectory-dao.js')).href);
  run('findDraftByReqAtomKey exported', () => {
    assert.equal(typeof dao.findDraftByReqAtomKey, 'function');
  });

  const parseMod = await import(pathToFileURL(join(ROOT, 'src/services/req-draft-traj/parse-through-chains.js')).href);
  const provMod = await import(pathToFileURL(join(ROOT, 'src/services/req-draft-traj/provenance.js')).href);

  const fixtureRoot = join(ROOT, 'scripts/characterization/fixtures/req-draft-traj/demo-mod');
  const md = readFileSync(join(fixtureRoot, 'through-chains.md'), 'utf8');

  run('parseThroughChainsMarkdown extracts chains and steps', () => {
    const parsed = parseMod.parseThroughChainsMarkdown(md);
    assert.ok(parsed.chains.length >= 1);
    assert.equal(parsed.chains[0].steps.length, 3);
  });

  run('buildAtomKey is module-scoped and slug-like', () => {
    const parsed = parseMod.parseThroughChainsMarkdown(md);
    const key = parseMod.buildAtomKey({
      moduleKey: 'demo-mod',
      chainId: parsed.chains[0].chainId,
      stepIndex: 2,
      title: parsed.chains[0].steps[1].action,
    });
    assert.match(key, /^demo-mod:/);
  });

  await runAsync('resolveChapterRef finds chapter by ZJJK', async () => {
    const parsed = parseMod.parseThroughChainsMarkdown(md);
    const chapter = await provMod.resolveChapterRef({
      chaptersDir: join(fixtureRoot, 'chapters'),
      chapterHint: parsed.chains[0].chapterHint,
      zjjk: 'ZJJK00094361',
    });
    assert.ok(chapter && /chapters\//.test(chapter.replace(/\\/g, '/')));
  });

  run('assertAtomProvenance rejects empty sourceDoc', () => {
    const parsed = parseMod.parseThroughChainsMarkdown(md);
    const key = parseMod.buildAtomKey({
      moduleKey: 'demo-mod',
      chainId: parsed.chains[0].chainId,
      stepIndex: 2,
      title: parsed.chains[0].steps[1].action,
    });
    const bad = provMod.assertAtomProvenance({
      atomKey: key,
      sourceDoc: '',
      sourceChapter: 'chapters/01-product-library.md#产品库管理',
    });
    assert.equal(bad.ok, false);
  });

  console.log(`OK ${passed}`);
}

main();
