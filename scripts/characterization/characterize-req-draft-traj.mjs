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

  const { fromDbRow } = await import(pathToFileURL(join(ROOT, 'src/dao/helpers.js')).href);
  run('fromDbRow surfaces trajectory provenance columns (GET detail passthrough)', () => {
    const entity = fromDbRow({
      id: 42,
      req_module_key: 'demo-mod',
      req_source_path: 'demo.docx',
      req_chapter_ref: 'chapters/01-product-library.md#产品库管理',
      req_atom_key: 'demo-mod:chain-a:2:新增一级分类',
      record_status: 'draft',
    });
    assert.equal(entity.reqModuleKey, 'demo-mod');
    assert.equal(entity.reqSourcePath, 'demo.docx');
    assert.equal(entity.reqChapterRef, 'chapters/01-product-library.md#产品库管理');
    assert.equal(entity.reqAtomKey, 'demo-mod:chain-a:2:新增一级分类');
    assert.equal(entity.recordStatus, 'draft');
  });

  run('getTrajectoryWithPhases returns full dao entity (no field allowlist)', () => {
    const src = readFileSync(
      join(ROOT, 'src/services/trajectory/trajectory-query-service.js'),
      'utf8',
    );
    assert.match(src, /export async function getTrajectoryWithPhases/);
    assert.match(src, /return traj;/);
    assert.doesNotMatch(src, /\breqModuleKey\b.*\bdelete\b/);
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

  await runAsync('proposeDraftTrajectories rejects empty taskDraft', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-'));
    cpSync(fixtureRoot, join(tmp, 'demo-mod'), { recursive: true });

    const fakeLLM = async () => JSON.stringify({
      atoms: [
        {
          chainId: 'chain-a',
          stepIndexes: [2],
          title: '新增一级分类',
          taskDraft: '   ',
          phaseHints: ['新增一级分类'],
        },
      ],
    });

    const out = await proposeDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      callLLM: fakeLLM,
    });
    assert.equal(out.atoms.length, 0);
    assert.ok(out.rejected.some((r) => r.reason === 'empty_task_draft'));
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('proposeDraftTrajectories truncates atoms with maxAtoms', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-'));
    cpSync(fixtureRoot, join(tmp, 'demo-mod'), { recursive: true });

    const fakeLLM = async () => JSON.stringify({
      atoms: [
        {
          chainId: 'chain-a',
          stepIndexes: [2],
          title: '新增一级分类',
          taskDraft: '1、新增一级分类。\n\n来源：demo.docx\n',
          phaseHints: ['新增一级分类'],
        },
        {
          chainId: 'chain-a',
          stepIndexes: [3],
          title: '选中分类下新增子分类',
          taskDraft: '1、选中分类下新增子分类。\n\n来源：demo.docx\n',
          phaseHints: ['新增子分类'],
        },
      ],
    });

    const out = await proposeDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      maxAtoms: 1,
      callLLM: fakeLLM,
    });
    assert.equal(out.atoms.length, 1);
    assert.equal(out.atoms[0].title, '新增一级分类');
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

  const { writeProposeCache } = await import(pathToFileURL(join(ROOT, 'src/services/req-draft-traj/propose-cache.js')).href);
  const { commitDraftTrajectories } = await import(pathToFileURL(join(ROOT, 'src/services/req-draft-traj/commit.js')).href);

  const GOOD_ATOM_KEY = 'demo-mod:chain-a:2:新增一级分类';
  const GOOD_ATOM = {
    atomKey: GOOD_ATOM_KEY,
    title: '新增一级分类',
    suggestedFunctionId: 9000000740,
    sourceDoc: 'demo.docx',
    sourceChapter: 'chapters/01-product-library.md#产品库管理',
    taskDraft: '1、进入产品库。\n2、点击新增一级分类，名称填「KB测一级」，序号填「1」，确定。\n\n来源：demo.docx / chapters/01-product-library.md\n\n关键数据\n分类名称：KB测一级\n序号：1\n',
  };

  async function seedCache(tmp, atoms) {
    const modDir = join(tmp, 'demo-mod');
    cpSync(fixtureRoot, modDir, { recursive: true });
    await writeProposeCache(modDir, { atoms, rejected: [] });
    return tmp;
  }

  await runAsync('commitDraftTrajectories skips unknown atomKey', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-commit-'));
    await seedCache(tmp, [GOOD_ATOM]);

    const out = await commitDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      atomKeys: ['demo-mod:chain-a:9:不存在'],
      analyzeFn: async () => ({ phases: ['x'], businessEntries: [] }),
      createFn: async () => ({ id: 1 }),
      findDraftFn: async () => null,
    });
    assert.equal(out.created.length, 0);
    assert.equal(out.skipped.length, 1);
    assert.match(out.skipped[0].reason, /unknown|stale/);
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('commitDraftTrajectories creates draft with provenance', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-commit-'));
    await seedCache(tmp, [GOOD_ATOM]);

    let createOpts;
    const out = await commitDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      atomKeys: [GOOD_ATOM_KEY],
      analyzeFn: async () => ({
        phases: [
          '进入产品库。预期结果：抵达产品库管理页面。',
          '新增一级分类。预期结果：出现操作成功。',
        ],
        businessEntries: [{ fieldKey: '分类名称', fieldValue: 'KB测一级' }],
      }),
      createFn: async (opts) => {
        createOpts = opts;
        return { id: 4242, name: opts.name };
      },
      findDraftFn: async () => null,
    });
    assert.equal(out.created[0].trajectoryId, 4242);
    assert.equal(createOpts.reqModuleKey, 'demo-mod');
    assert.ok(createOpts.reqSourcePath);
    assert.ok(createOpts.reqChapterRef);
    assert.equal(createOpts.reqAtomKey, GOOD_ATOM_KEY);
    assert.equal(createOpts.recordStatus ?? 'draft', 'draft');
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('commitDraftTrajectories skips duplicate draft without force', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-commit-'));
    await seedCache(tmp, [GOOD_ATOM]);

    let callCount = 0;
    const out = await commitDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      atomKeys: [GOOD_ATOM_KEY],
      analyzeFn: async () => ({ phases: ['x'], businessEntries: [] }),
      createFn: async () => {
        callCount += 1;
        return { id: 4242 };
      },
      findDraftFn: async () => ({ id: 4242 }),
    });
    assert.equal(out.created.length, 0);
    assert.equal(out.skipped.length, 1);
    assert.match(out.skipped[0].reason, /duplicate/);
    assert.equal(callCount, 0);
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('commitDraftTrajectories skips atom missing provenance in cache', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-commit-'));
    const badAtom = { ...GOOD_ATOM, sourceDoc: '' };
    await seedCache(tmp, [badAtom]);

    const out = await commitDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      atomKeys: [GOOD_ATOM_KEY],
      analyzeFn: async () => ({ phases: ['x'], businessEntries: [] }),
      createFn: async () => ({ id: 1 }),
      findDraftFn: async () => null,
    });
    assert.equal(out.created.length, 0);
    assert.equal(out.skipped.length, 1);
    assert.ok(out.skipped[0].reason);
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('commitDraftTrajectories skips missing_function_id when suggestedFunctionId null and no override', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-commit-'));
    const noFnAtom = { ...GOOD_ATOM, suggestedFunctionId: null };
    await seedCache(tmp, [noFnAtom]);

    let analyzeCalled = false;
    const out = await commitDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      atomKeys: [GOOD_ATOM_KEY],
      analyzeFn: async () => {
        analyzeCalled = true;
        return { phases: ['x'], businessEntries: [] };
      },
      createFn: async () => ({ id: 1 }),
      findDraftFn: async () => null,
    });
    assert.equal(out.created.length, 0);
    assert.equal(out.skipped.length, 1);
    assert.equal(out.skipped[0].reason, 'missing_function_id');
    assert.equal(analyzeCalled, false);
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('commitDraftTrajectories tolerates functionIdOverrides null', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-commit-'));
    await seedCache(tmp, [GOOD_ATOM]);

    const out = await commitDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      atomKeys: [GOOD_ATOM_KEY],
      functionIdOverrides: null,
      analyzeFn: async () => ({ phases: ['x'], businessEntries: [] }),
      createFn: async () => ({ id: 4242 }),
      findDraftFn: async () => null,
    });
    assert.equal(out.created.length, 1);
    assert.equal(out.created[0].trajectoryId, 4242);
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('commitDraftTrajectories exported from index', async () => {
    const idx = await import(pathToFileURL(join(ROOT, 'src/services/req-draft-traj/index.js')).href);
    assert.equal(typeof idx.commitDraftTrajectories, 'function');
  });


  await runAsync('kb.js wires draft-traj propose and commit routes', async () => {
    const src = readFileSync(join(ROOT, 'src/routes/v2/kb.js'), 'utf8');
    assert.match(src, /draft-traj\/propose/);
    assert.match(src, /draft-traj\/commit/);
    assert.match(src, /proposeDraftTrajectories|reqDraftTraj\.propose/);
    assert.match(src, /commitDraftTrajectories|reqDraftTraj\.commit/);
  });

  console.log(`OK ${passed}`);
}

main();
