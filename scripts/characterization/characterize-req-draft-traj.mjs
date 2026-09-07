/**
 * Characterization: req→draft-traj (DAO + parse/provenance helpers).
 *
 * Run:
 *   node scripts/characterization/characterize-req-draft-traj.mjs
 */
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

  const { proposeDraftTrajectories } = await import(pathToFileURL(join(ROOT, 'src/services/req-draft-traj/propose.js')).href);
  const { AppError } = await import(pathToFileURL(join(ROOT, 'src/http/app-error.js')).href);

  await runAsync('proposeDraftTrajectories on fixture with fakeLLM', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-'));
    cpSync(fixtureRoot, join(tmp, 'demo-mod'), { recursive: true });

    const fakeLLM = async () => JSON.stringify({
      atoms: [
        {
          chainId: 'chain-a',
          stepIndexes: [2],
          title: '新增一级分类',
          taskDraft: '1、进入产品库。\n2、点击新增一级分类，名称填「KB测一级」，序号填「1」，确定。\n\n来源：demo.docx / chapters/01-product-library.md\n\n关键数据\n分类名称：KB测一级\n序号：1\n',
          phaseHints: ['进入产品库', '新增一级分类并确定'],
          suggestedFunctionId: 9000000740,
        },
      ],
    });

    const out = await proposeDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      callLLM: fakeLLM,
    });
    assert.ok(out.atoms.length >= 1);
    assert.ok(out.atoms.every((a) => a.sourceDoc && a.sourceChapter && a.atomKey));
    assert.ok(!out.atoms.some((a) => !a.sourceChapter));
    const cachePath = join(tmp, 'demo-mod', '.draft-traj-propose.json');
    assert.ok(existsSync(cachePath));
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('proposeDraftTrajectories rejects missing through-chains', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-'));
    cpSync(fixtureRoot, join(tmp, 'demo-mod'), { recursive: true });
    rmSync(join(tmp, 'demo-mod', 'through-chains.md'), { force: true });

    let err;
    try {
      await proposeDraftTrajectories({
        moduleKey: 'demo-mod',
        rootDir: tmp,
        callLLM: async () => '{"atoms":[]}',
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof AppError);
    assert.equal(err.code, 'VALIDATION');
    rmSync(tmp, { recursive: true, force: true });
  });

  console.log(`OK ${passed}`);
}

main();
