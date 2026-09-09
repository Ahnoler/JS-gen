/**
 * Characterization: req→draft-traj (DAO + parse/provenance helpers).
 *
 * Run:
 *   node scripts/characterization/characterize-req-draft-traj.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
// F-B: keep observability writes out of the repo (data/kb/staging).
const OBSERVE_TMP = mkdtempSync(join(tmpdir(), 'kb-observe-'));
process.env.KB_STAGING_DIR = OBSERVE_TMP;
const REPO_OBSERVE_FILE = join(ROOT, 'data/kb/staging/propose-runs.jsonl');
const repoObserveMtime = existsSync(REPO_OBSERVE_FILE) ? statSync(REPO_OBSERVE_FILE).mtimeMs : 0;
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

  run('buildAtomKey is title-independent and stable', () => {
    assert.equal(
      parseMod.buildAtomKey({ moduleKey: 'product-mgmt', chainId: 'chain-a', stepIndex: 2 }),
      'product-mgmt:chain-a:2',
    );
    assert.equal(parseMod.buildAtomKey({ moduleKey: 'product-mgmt', chainId: 'chain-a' }), 'product-mgmt:chain-a:0');
    assert.equal(
      parseMod.buildAtomKey({ moduleKey: 'product-mgmt', chainId: 'chain-a', stepIndex: 2, title: '完全不同的标题' }),
      'product-mgmt:chain-a:2',
    );
  });

  await runAsync('resolveChapterRef finds chapter by ZJJK', async () => {
    const parsed = parseMod.parseThroughChainsMarkdown(md);
    const chapter = await provMod.resolveChapterRef({
      chaptersDir: join(fixtureRoot, 'chapters'),
      chapterHint: parsed.chains[0].chapterHint,
      zjjk: 'ZJJK00094361',
    });
    assert.ok(chapter && /chapters\//.test(chapter.ref.replace(/\\/g, '/')));
  });

  await runAsync('resolveChapterRef returns stable chunkId and content-bound sourceHash', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-anchor-'));
    const chaptersDir = join(tmp, 'chapters');
    mkdirSync(chaptersDir, { recursive: true });
    const body = '# 产品信息管理 → 配置产品信息\n\n产品信息配置页签 ZJJK00136564 主定义\n';
    writeFileSync(join(chaptersDir, '03-配置产品信息.md'), body, 'utf8');
    const opts = { chaptersDir, chapterHint: '§配置产品信息', zjjk: 'ZJJK00136564', actionHint: '配置' };
    const a = await provMod.resolveChapterRef(opts);
    const b = await provMod.resolveChapterRef(opts);
    assert.equal(a.chunkId, b.chunkId);
    assert.equal(a.chunkId, '03-配置产品信息#产品信息管理→配置产品信息');
    assert.equal(a.sourceHash.length, 64);
    writeFileSync(join(chaptersDir, '03-配置产品信息.md'), body + '\n新增段落\n', 'utf8');
    const c = await provMod.resolveChapterRef(opts);
    assert.equal(c.chunkId, a.chunkId);
    assert.notEqual(c.sourceHash, a.sourceHash);
    rmSync(tmp, { recursive: true, force: true });
  });

  run('extractZjjkCodes keeps ordered unique real codes', () => {
    assert.deepEqual(
      provMod.extractZjjkCodes('ZJJK00136564 / ZJJK00136733'),
      ['ZJJK00136564', 'ZJJK00136733'],
    );
    assert.deepEqual(provMod.extractZjjkCodes('—'), []);
    assert.deepEqual(provMod.extractZjjkCodes('主页'), []);
  });

  run('fillTaskDraftProvenancePlaceholders replaces markers', () => {
    const filled = provMod.fillTaskDraftProvenancePlaceholders(
      '步骤\n\n来源：<sourceDoc> / <sourceChapter>',
      'demo.docx',
      'chapters/01-product-library.md#产品库管理',
    );
    assert.equal(filled.includes('<sourceDoc>'), false);
    assert.equal(filled.includes('<sourceChapter>'), false);
    assert.match(filled, /demo\.docx/);
    assert.match(filled, /chapters\/01-product-library\.md/);
  });

  await runAsync('resolveChapterRef multi-ZJJK picks defining chapter over 复用/overview', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-chapters-'));
    const chaptersDir = join(tmp, 'chapters');
    mkdirSync(chaptersDir, { recursive: true });
    writeFileSync(join(chaptersDir, '01-总体概述.md'), '# 总体概述\n\n功能列表提及 ZJJK00136564\n', 'utf8');
    writeFileSync(
      join(chaptersDir, '03-配置产品信息.md'),
      '# 产品信息管理 → 配置产品信息\n\n产品信息配置页签 ZJJK00136564 主定义\n',
      'utf8',
    );
    writeFileSync(
      join(chaptersDir, '06-查询产品.md'),
      '# 产品信息管理 → 查询产品\n\n详情复用 ZJJK00136564（复用）\n',
      'utf8',
    );
    const chapter = await provMod.resolveChapterRef({
      chaptersDir,
      chapterHint: '§配置产品信息 → §产品详细信息（ZJJK00107304/136564）',
      zjjk: 'ZJJK00136564 / ZJJK00136733',
      actionHint: '公共要素配置保存',
    });
    assert.match(String(chapter?.ref || ''), /03-配置产品信息/);
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('resolveChapterRef ignores placeholder ZJJK and uses chapterHint', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-chapters-'));
    const chaptersDir = join(tmp, 'chapters');
    mkdirSync(chaptersDir, { recursive: true });
    writeFileSync(join(chaptersDir, '01-总体概述.md'), '# 总体概述\n\n无操作正文\n', 'utf8');
    writeFileSync(
      join(chaptersDir, '03-配置产品信息.md'),
      '# 产品信息管理 → 配置产品信息\n\n上移/下移：同层排序\n启用规则\n',
      'utf8',
    );
    const chapter = await provMod.resolveChapterRef({
      chaptersDir,
      chapterHint: '§配置产品信息 → §产品库管理；启用规则见主页【启用】',
      zjjk: '—',
      actionHint: '同层节点排序',
    });
    assert.match(String(chapter?.ref || ''), /03-配置产品信息/);
    rmSync(tmp, { recursive: true, force: true });
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
          taskDraft: '1、进入产品库。\n2、点击新增一级分类，名称填「KB测一级」，序号填「1」，确定。\n\n来源：<sourceDoc> / <sourceChapter>\n\n关键数据\n分类名称：KB测一级\n序号：1\n',
          phaseHints: ['进入产品库', '新增一级分类并确定'],
          suggestedFunctionId: 9000000740,
        },
      ],
    });

    const out = await proposeDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      callLLM: fakeLLM,
      functionIdExists: async () => true,
    });
    assert.ok(out.atoms.length >= 1);
    assert.ok(out.atoms.every((a) => a.sourceDoc && a.sourceChapter && a.atomKey));
    assert.ok(!out.atoms.some((a) => !a.sourceChapter));
    assert.equal(out.atoms[0].taskDraft.includes('<sourceDoc>'), false);
    assert.equal(out.atoms[0].taskDraft.includes('<sourceChapter>'), false);
    assert.ok(out.atoms[0].taskDraft.includes(out.atoms[0].sourceDoc));
    assert.ok(out.atoms[0].taskDraft.includes(out.atoms[0].sourceChapter));
    assert.ok(Array.isArray(out.atoms[0].pageCodes));
    assert.equal(out.atoms[0].flowGuided, false);
    const cachePath = join(tmp, 'demo-mod', '.draft-traj-propose.json');
    assert.ok(existsSync(cachePath));
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('propose observability honors KB_STAGING_DIR and never touches the repo staging dir', async () => {
    assert.ok(existsSync(join(OBSERVE_TMP, 'propose-runs.jsonl')), 'isolated staging dir should receive propose-runs.jsonl');
    const repoMtime = existsSync(REPO_OBSERVE_FILE) ? statSync(REPO_OBSERVE_FILE).mtimeMs : 0;
    assert.equal(repoMtime, repoObserveMtime, 'repo data/kb/staging/propose-runs.jsonl must not be written by characterization');
  });

  await runAsync('proposeDraftTrajectories sanitizes ZJJK from 关键数据 into pageCodes', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-'));
    cpSync(fixtureRoot, join(tmp, 'demo-mod'), { recursive: true });

    const fakeLLM = async () => JSON.stringify({
      atoms: [
        {
          chainId: 'chain-a',
          stepIndexes: [2],
          title: '新增一级分类',
          taskDraft: '1、新增一级分类。\n\n来源：demo.docx\n\n关键数据\nZJJK00107304\n',
          phaseHints: ['新增一级分类'],
        },
      ],
    });

    const out = await proposeDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      callLLM: fakeLLM,
      listSystemsFn: async () => [],
    });
    assert.equal(out.atoms.length, 1);
    assert.ok(Array.isArray(out.atoms[0].pageCodes));
    assert.ok(out.atoms[0].pageCodes.includes('ZJJK00107304'));
    assert.equal(out.atoms[0].taskDraft.includes('关键数据\nZJJK'), false);
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('propose fallback folds open-drawer entry into next save atom', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-'));
    cpSync(fixtureRoot, join(tmp, 'demo-mod'), { recursive: true });
    writeFileSync(
      join(tmp, 'demo-mod', 'chapters', '02-客户信息维护.md'),
      '# 客户信息维护\n\n对公客户主页 ZJJK00066153\n新增对公客户主页 ZJJK00066158\n',
      'utf8',
    );
    writeFileSync(
      join(tmp, 'demo-mod', 'through-chains.md'),
      [
        '# through-chains',
        '',
        '### 主链 A：对公客户新增',
        '',
        '- **章节出处**：章2 客户信息维护',
        '',
        '| # | 步骤 | 页面/弹窗 | ZJJK | 关键按钮 |',
        '|---|------|-----------|------|----------|',
        '| 1 | 对公客户主页，点【新增】打开向导抽屉 | 对公客户主页 | ZJJK00066153 | 【新增】 |',
        '| 2 | 新增对公客户主页：选类型→录证件→【保存】 | 新增对公客户主页 | ZJJK00066158 | 【保存】 |',
        '',
      ].join('\n'),
      'utf8',
    );

    const out = await proposeDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      callLLM: async () => { throw new Error('force fallback'); },
      listSystemsFn: async () => [],
    });
    assert.equal(out.atoms.length, 1, `expected 1 atom, got ${out.atoms.length}: ${out.atoms.map((a) => a.title).join(' | ')} rejected=${JSON.stringify(out.rejected)}`);
    assert.match(out.atoms[0].taskDraft, /打开向导抽屉/);
    assert.match(out.atoms[0].taskDraft, /【保存】|保存/);
    assert.equal(out.atoms[0].kind, 'write');
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('propose folds LLM open-drawer atom into following write atom', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-'));
    cpSync(fixtureRoot, join(tmp, 'demo-mod'), { recursive: true });
    writeFileSync(
      join(tmp, 'demo-mod', 'chapters', '02-客户信息维护.md'),
      '# 客户信息维护\n\n对公客户主页 ZJJK00066153\n新增对公客户主页 ZJJK00066158\n',
      'utf8',
    );
    writeFileSync(
      join(tmp, 'demo-mod', 'through-chains.md'),
      [
        '# through-chains',
        '',
        '### 主链 A：对公客户新增',
        '',
        '- **章节出处**：章2 客户信息维护',
        '',
        '| # | 步骤 | 页面/弹窗 | ZJJK | 关键按钮 |',
        '|---|------|-----------|------|----------|',
        '| 1 | 对公客户主页，点【新增】打开向导抽屉 | 对公客户主页 | ZJJK00066153 | 【新增】 |',
        '| 2 | 新增对公客户主页：选类型→录证件→【保存】 | 新增对公客户主页 | ZJJK00066158 | 【保存】 |',
        '',
      ].join('\n'),
      'utf8',
    );

    const fakeLLM = async () => JSON.stringify({
      atoms: [
        {
          chainId: 'chain-a',
          stepIndexes: [1],
          title: '对公客户主页，点【新增】打开向导抽屉',
          taskDraft: '1、对公客户主页，点【新增】打开向导抽屉\n\n来源：demo.docx\n',
          phaseHints: ['打开向导抽屉'],
        },
        {
          chainId: 'chain-a',
          stepIndexes: [2],
          title: '新增对公客户并保存',
          taskDraft: '1、选类型→录证件→【保存】\n\n来源：demo.docx\n',
          phaseHints: ['保存'],
        },
      ],
    });

    const out = await proposeDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      callLLM: fakeLLM,
      listSystemsFn: async () => [],
    });
    assert.equal(out.atoms.length, 1, `expected 1 folded atom, got ${out.atoms.length} rejected=${JSON.stringify(out.rejected)}`);
    assert.match(out.atoms[0].taskDraft, /打开向导抽屉/);
    assert.match(out.atoms[0].taskDraft, /【保存】|保存/);
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('proposeDraftTrajectories nulls unknown suggestedFunctionId (FK guard)', async () => {
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
          suggestedFunctionId: 90000107304,
        },
      ],
    });

    const out = await proposeDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      callLLM: fakeLLM,
      functionIdExists: async () => false,
      listSystemsFn: async () => [],
    });
    assert.equal(out.atoms.length, 1);
    assert.equal(out.atoms[0].suggestedFunctionId, null);
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
      listSystemsFn: async () => [],
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

  await runAsync('proposeDraftTrajectories rejects prose-only through-chains (no step table)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-'));
    cpSync(fixtureRoot, join(tmp, 'demo-mod'), { recursive: true });
    writeFileSync(
      join(tmp, 'demo-mod', 'through-chains.md'),
      '# 需求\n\n散文体描述，没有步骤表。\n',
      'utf8',
    );

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
    assert.match(err.message, /no parseable step table/);
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('proposeDraftTrajectories rejects chainIds matching no chains', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-'));
    cpSync(fixtureRoot, join(tmp, 'demo-mod'), { recursive: true });

    let err;
    try {
      await proposeDraftTrajectories({
        moduleKey: 'demo-mod',
        rootDir: tmp,
        chainIds: ['nope'],
        callLLM: async () => '{"atoms":[]}',
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof AppError);
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /matched no chains/);
    rmSync(tmp, { recursive: true, force: true });
  });

  const { writeProposeCache, PROPOSE_CACHE_VERSION } = await import(pathToFileURL(join(ROOT, 'src/services/req-draft-traj/propose-cache.js')).href);
  run('PROPOSE_CACHE_VERSION is 2 (flow-guided propose)', () => {
    assert.equal(PROPOSE_CACHE_VERSION, 2);
  });
  const { commitDraftTrajectories } = await import(pathToFileURL(join(ROOT, 'src/services/req-draft-traj/commit.js')).href);
  const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

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
    const md = readFileSync(join(modDir, 'through-chains.md'), 'utf8');
    await writeProposeCache(modDir, { atoms, rejected: [], sourceHash: sha256(md) });
    return tmp;
  }

  await runAsync('writeProposeCache emits cacheVersion+hashes atomically', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-cache-'));
    const modDir = join(tmp, 'demo-mod');
    mkdirSync(modDir, { recursive: true });
    const body = await writeProposeCache(modDir, {
      atoms: [],
      rejected: [],
      sourceHash: 'a'.repeat(64),
      inputHash: 'b'.repeat(64),
      truncated: { dropped: 0, requestedMax: null },
    });
    assert.equal(body.cacheVersion, 2);
    assert.ok(body.sourceHash && body.inputHash);
    const raw = JSON.parse(readFileSync(join(modDir, '.draft-traj-propose.json'), 'utf8'));
    assert.equal(raw.cacheVersion, 2);
    assert.equal(raw.sourceHash, 'a'.repeat(64));
    assert.equal(existsSync(join(modDir, '.draft-traj-propose.json.tmp')), false);
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('propose writes cache with through-chains sourceHash', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-'));
    cpSync(fixtureRoot, join(tmp, 'demo-mod'), { recursive: true });

    const fakeLLM = async () => JSON.stringify({
      atoms: [
        { chainId: 'chain-a', stepIndexes: [2], title: '新增一级分类', taskDraft: '1、新增一级分类。\n\n来源：demo.docx\n', phaseHints: ['x'] },
      ],
    });
    await proposeDraftTrajectories({ moduleKey: 'demo-mod', rootDir: tmp, callLLM: fakeLLM, listSystemsFn: async () => [] });
    const cache = JSON.parse(readFileSync(join(tmp, 'demo-mod', '.draft-traj-propose.json'), 'utf8'));
    const md = readFileSync(join(tmp, 'demo-mod', 'through-chains.md'), 'utf8');
    assert.equal(cache.cacheVersion, 2);
    assert.equal(cache.sourceHash, sha256(md));
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('commit rejects cache without cacheVersion (STALE_PROPOSE_CACHE)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-commit-'));
    const modDir = join(tmp, 'demo-mod');
    cpSync(fixtureRoot, modDir, { recursive: true });
    writeFileSync(join(modDir, '.draft-traj-propose.json'), JSON.stringify({
      updatedAt: new Date().toISOString(),
      atoms: [GOOD_ATOM],
      rejected: [],
    }), 'utf8');

    let err;
    try {
      await commitDraftTrajectories({
        moduleKey: 'demo-mod',
        rootDir: tmp,
        atomKeys: [GOOD_ATOM_KEY],
        analyzeFn: async () => ({ phases: ['x'], businessEntries: [] }),
        createFn: async () => ({ id: 1 }),
        findDraftFn: async () => null,
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.equal(err.code, 'STALE_PROPOSE_CACHE');
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('commit rejects stale through-chains sourceHash', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-commit-'));
    const modDir = join(tmp, 'demo-mod');
    cpSync(fixtureRoot, modDir, { recursive: true });
    const md = readFileSync(join(modDir, 'through-chains.md'), 'utf8');
    await writeProposeCache(modDir, { atoms: [GOOD_ATOM], rejected: [], sourceHash: sha256(md) });
    // mutate through-chains after propose → hash no longer matches
    writeFileSync(join(modDir, 'through-chains.md'), `${md}\n| 9 | 新增的步骤 | 页面 | ZJJK00000000 | 按钮 |\n`, 'utf8');

    let err;
    try {
      await commitDraftTrajectories({
        moduleKey: 'demo-mod',
        rootDir: tmp,
        atomKeys: [GOOD_ATOM_KEY],
        analyzeFn: async () => ({ phases: ['x'], businessEntries: [] }),
        createFn: async () => ({ id: 1 }),
        findDraftFn: async () => null,
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.equal(err.code, 'STALE_PROPOSE_CACHE');
    rmSync(tmp, { recursive: true, force: true });
  });

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
      functionIdExists: async () => true,
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

  await runAsync('findDraftByReqAtomKey matches non-draft rows too', async () => {
    const src = readFileSync(join(ROOT, 'src/dao/trajectory-dao.js'), 'utf8');
    const start = src.indexOf('export async function findDraftByReqAtomKey');
    const fn = src.slice(start, src.indexOf('\n}', start) + 2);
    assert.ok(fn.length > 0);
    assert.equal(fn.includes("record_status: 'draft'"), false);
  });

  await runAsync('commit duplicate skip covers any record_status (recorded row)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-commit-'));
    await seedCache(tmp, [GOOD_ATOM]);

    let createCalls = 0;
    const out = await commitDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      atomKeys: [GOOD_ATOM_KEY],
      analyzeFn: async () => ({ phases: ['x'], businessEntries: [] }),
      createFn: async () => {
        createCalls += 1;
        return { id: 1 };
      },
      findDraftFn: async () => ({ id: 77, recordStatus: 'recorded', reqAtomSeq: 0 }),
      functionIdExists: async () => true,
    });
    assert.equal(out.created.length, 0);
    assert.equal(out.skipped.length, 1);
    assert.match(out.skipped[0].reason, /duplicate/);
    assert.equal(createCalls, 0);
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('commit force increments req_atom_seq beyond existing', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-commit-'));
    await seedCache(tmp, [GOOD_ATOM]);

    const createdSeqs = [];
    const out = await commitDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      atomKeys: [GOOD_ATOM_KEY],
      force: true,
      analyzeFn: async () => ({ phases: ['x'], businessEntries: [] }),
      createFn: async (opts) => {
        createdSeqs.push(opts.reqAtomSeq);
        return { id: 100 + createdSeqs.length };
      },
      findDraftFn: async () => ({ id: 42, recordStatus: 'recorded', reqAtomSeq: 3 }),
      functionIdExists: async () => true,
    });
    assert.equal(out.created.length, 1);
    assert.deepEqual(createdSeqs, [4]);
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('commit converts ER_DUP_ENTRY to skipped duplicate_draft', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-commit-'));
    await seedCache(tmp, [GOOD_ATOM]);

    const dupErr = new Error('Duplicate entry');
    dupErr.code = 'ER_DUP_ENTRY';
    const out = await commitDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      atomKeys: [GOOD_ATOM_KEY],
      analyzeFn: async () => ({ phases: ['x'], businessEntries: [] }),
      createFn: async () => {
        throw dupErr;
      },
      findDraftFn: async () => null,
      functionIdExists: async () => true,
    });
    assert.equal(out.created.length, 0);
    assert.equal(out.skipped.length, 1);
    assert.equal(out.skipped[0].reason, 'duplicate_draft');
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('save/createTransactionWithPhases pass reqAtomSeq through', async () => {
    const metaSrc = readFileSync(join(ROOT, 'src/services/trajectory/trajectory-meta-service.js'), 'utf8');
    assert.match(metaSrc, /opts\.reqAtomSeq/);
    const daoSrc = readFileSync(join(ROOT, 'src/dao/trajectory-dao.js'), 'utf8');
    assert.match(daoSrc, /reqAtomSeq: trajectory\.reqAtomSeq \?\? 0/);
  });

  await runAsync('commit skips atom whose chapter drifted (stale_chapter_ref)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-anchor-'));
    const modDir = join(tmp, 'demo-mod');
    cpSync(fixtureRoot, modDir, { recursive: true });
    const chapterPath = join(modDir, 'chapters', '01-product-library.md');
    const chapterBody = readFileSync(chapterPath, 'utf8');
    const anchoredAtom = {
      ...GOOD_ATOM,
      sourceHash: createHash('sha256').update(chapterBody, 'utf8').digest('hex'),
      chunkId: '01-product-library#产品库管理',
    };
    const md = readFileSync(join(modDir, 'through-chains.md'), 'utf8');
    await writeProposeCache(modDir, { atoms: [anchoredAtom], rejected: [], sourceHash: sha256(md) });
    // drift the chapter after propose
    writeFileSync(chapterPath, `${chapterBody}\n新增段落\n`, 'utf8');

    const out = await commitDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      atomKeys: [GOOD_ATOM_KEY],
      analyzeFn: async () => ({ phases: ['x'], businessEntries: [] }),
      createFn: async () => ({ id: 1 }),
      findDraftFn: async () => null,
      functionIdExists: async () => true,
    });
    assert.equal(out.created.length, 0);
    assert.equal(out.skipped.length, 1);
    assert.equal(out.skipped[0].reason, 'stale_chapter_ref');
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('commit passes sourceHash/chunkId into create', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-anchor-'));
    const modDir = join(tmp, 'demo-mod');
    cpSync(fixtureRoot, modDir, { recursive: true });
    const chapterPath = join(modDir, 'chapters', '01-product-library.md');
    const chapterBody = readFileSync(chapterPath, 'utf8');
    const anchoredAtom = {
      ...GOOD_ATOM,
      sourceHash: createHash('sha256').update(chapterBody, 'utf8').digest('hex'),
      chunkId: '01-product-library#产品库管理',
    };
    const md = readFileSync(join(modDir, 'through-chains.md'), 'utf8');
    await writeProposeCache(modDir, { atoms: [anchoredAtom], rejected: [], sourceHash: sha256(md) });

    let createOpts;
    await commitDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      atomKeys: [GOOD_ATOM_KEY],
      analyzeFn: async () => ({ phases: ['x'], businessEntries: [] }),
      createFn: async (opts) => {
        createOpts = opts;
        return { id: 4242 };
      },
      findDraftFn: async () => null,
      functionIdExists: async () => true,
    });
    assert.equal(createOpts.reqSourceHash, anchoredAtom.sourceHash);
    assert.equal(createOpts.reqChunkId, anchoredAtom.chunkId);
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
      functionIdExists: async () => true,
    });
    assert.equal(out.created.length, 1);
    assert.equal(out.created[0].trajectoryId, 4242);
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('commitDraftTrajectories skips unknown_function_id when existence check fails', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-commit-'));
    await seedCache(tmp, [GOOD_ATOM]);

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
      functionIdExists: async () => false,
    });
    assert.equal(out.created.length, 0);
    assert.equal(out.skipped.length, 1);
    assert.equal(out.skipped[0].reason, 'unknown_function_id');
    assert.equal(analyzeCalled, false);
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

  const { validateCommitAtoms } = await import(pathToFileURL(join(ROOT, 'src/services/req-draft-traj/commit.js')).href);

  await runAsync('validateCommitAtoms exported from index', async () => {
    const idx = await import(pathToFileURL(join(ROOT, 'src/services/req-draft-traj/index.js')).href);
    assert.equal(typeof idx.validateCommitAtoms, 'function');
  });

  await runAsync('validate problems match commit skipped for same input', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-validate-'));
    const noFnAtom = { ...GOOD_ATOM, atomKey: 'demo-mod:chain-a:3', title: '无功能', suggestedFunctionId: null };
    await seedCache(tmp, [GOOD_ATOM, noFnAtom]);

    const findDraftStub = async (_mk, ak) => (ak === 'demo-mod:chain-a:2' ? { id: 9, recordStatus: 'recorded', reqAtomSeq: 0 } : null);
    const analyzeFn = async () => ({ phases: ['x'], businessEntries: [] });
    const createFn = async () => ({ id: 4242 });
    const common = {
      moduleKey: 'demo-mod',
      rootDir: tmp,
      atomKeys: ['demo-mod:chain-a:2', 'demo-mod:chain-a:3', 'demo-mod:chain-a:8:不存在'],
      analyzeFn,
      createFn,
      findDraftFn: findDraftStub,
      functionIdExists: async () => true,
    };
    const committed = await commitDraftTrajectories(common);
    const validated = await validateCommitAtoms(common);
    const skippedKeys = committed.skipped.map((s) => `${s.atomKey}:${s.reason}`).sort();
    const problemKeys = validated.problems.map((p) => `${p.atomKey}:${p.code}`).sort();
    assert.deepEqual(problemKeys, skippedKeys);
    assert.deepEqual(validated.ok, committed.created.map((c) => c.atomKey));
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('commit passes paasUserId through to create', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-commit-'));
    await seedCache(tmp, [GOOD_ATOM]);

    let createOpts;
    await commitDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      atomKeys: [GOOD_ATOM_KEY],
      paasUserId: 'u-12345',
      analyzeFn: async () => ({ phases: ['x'], businessEntries: [] }),
      createFn: async (opts) => {
        createOpts = opts;
        return { id: 4242 };
      },
      findDraftFn: async () => null,
      functionIdExists: async () => true,
    });
    assert.equal(createOpts.paasUserId, 'u-12345');
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('kb.js wires draft-traj validate route', async () => {
    const src = readFileSync(join(ROOT, 'src/routes/v2/kb.js'), 'utf8');
    assert.match(src, /draft-traj\/validate/);
    assert.match(src, /validateCommitAtoms/);
  });

  await runAsync('kb.js source upload implemented (no 501) and prefers local copy', async () => {
    const src = readFileSync(join(ROOT, 'src/routes/v2/kb.js'), 'utf8');
    assert.match(src, /uploadFileSingle/);
    assert.doesNotMatch(src, /not implemented in v1/);

    const tmp = mkdtempSync(join(tmpdir(), 'req-source-'));
    const modDir = join(tmp, 'demo-mod');
    mkdirSync(modDir, { recursive: true });
    writeFileSync(join(modDir, 'source.link.json'), JSON.stringify({
      sourcePath: 'C:/外部路径/demo.docx',
      localCopy: 'source/demo.docx',
    }), 'utf8');
    mkdirSync(join(modDir, 'source'), { recursive: true });
    writeFileSync(join(modDir, 'source', 'demo.docx'), 'doc-bytes', 'utf8');
    const doc = await provMod.loadSourceDoc(modDir);
    assert.equal(doc, 'source/demo.docx');

    writeFileSync(join(modDir, 'source.link.json'), JSON.stringify({
      sourcePath: 'C:/外部路径/demo.docx',
      localCopy: 'source/已被删除.docx',
    }), 'utf8');
    const fallback = await provMod.loadSourceDoc(modDir);
    assert.equal(fallback, 'C:/外部路径/demo.docx');
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('propose appends observation lines to staging JSONL', async () => {    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-obs-'));
    cpSync(fixtureRoot, join(tmp, 'demo-mod'), { recursive: true });
    const fakeLLM = async () => JSON.stringify({
      atoms: [
        { chainId: 'chain-a', stepIndexes: [2], title: '新增一级分类', taskDraft: '1、新增一级分类。\n\n来源：demo.docx\n', phaseHints: ['x'] },
      ],
    });
    let before = 0;
    try {
      before = readFileSync(join(OBSERVE_TMP, 'propose-runs.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).length;
    } catch {
      before = 0;
    }
    await proposeDraftTrajectories({ moduleKey: 'demo-mod', rootDir: tmp, callLLM: fakeLLM, listSystemsFn: async () => [] });
    await proposeDraftTrajectories({ moduleKey: 'demo-mod', rootDir: tmp, callLLM: fakeLLM, listSystemsFn: async () => [] });
    const lines = readFileSync(join(OBSERVE_TMP, 'propose-runs.jsonl'), 'utf8').split('\n').filter((l) => l.trim());
    assert.equal(lines.length, before + 2);
    const last = JSON.parse(lines[lines.length - 1]);
    for (const field of ['ts', 'moduleKey', 'atoms', 'rejected', 'truncated', 'cacheVersion', 'sourceHash', 'durationMs', 'flowRefHits', 'functionIdCandidateHits', 'flowGuidedCount', 'fallbackCount']) {
      assert.ok(field in last, `observation missing field ${field}`);
    }
    assert.equal(last.moduleKey, 'demo-mod');
    assert.equal(last.cacheVersion, 2);
    rmSync(tmp, { recursive: true, force: true });
  });

  const { computeFunctionIdCandidates } = await import(pathToFileURL(join(ROOT, 'src/services/req-draft-traj/propose.js')).href);

  run('computeFunctionIdCandidates ranks page_code over name_match', () => {
    const nodes = [
      { id: 7, type: 3, name: '对公客户管理', pdCmptEcd: 'ZJJK00066153', umlEcd: '', menuXpath: '' },
      { id: 21, type: 3, name: '产品库管理', pdCmptEcd: '', umlEcd: '', menuXpath: '' },
      { id: 22, type: 2, name: '非功能节点', pdCmptEcd: 'ZJJK00066153', umlEcd: '', menuXpath: '' },
    ];
    const out = computeFunctionIdCandidates({
      title: '在产品库管理新增一级分类',
      taskDraft: '1、在产品库管理新增一级分类。',
      pageCodes: ['ZJJK00066153'],
      sourceChapter: 'chapters/01-产品库管理.md#产品库管理',
    }, nodes);
    assert.deepEqual(out.map((c) => `${c.id}:${c.reason}`), ['7:page_code', '21:name_match']);
    assert.ok(out.every((c) => typeof c.id === 'number' && c.name && typeof c.score === 'number'));
    assert.ok(out.length <= 3);
  });

  await runAsync('propose attaches functionIdCandidates when suggestedFunctionId null', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-'));
    cpSync(fixtureRoot, join(tmp, 'demo-mod'), { recursive: true });

    const fakeLLM = async () => JSON.stringify({
      atoms: [
        { chainId: 'chain-a', stepIndexes: [2], title: '新增一级分类', taskDraft: '1、新增一级分类。\n\n来源：demo.docx\n', phaseHints: ['x'] },
      ],
    });
    const out = await proposeDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      callLLM: fakeLLM,
      listSystemsFn: async () => [
        { id: 9000000740, type: 3, name: '产品库管理', pdCmptEcd: 'ZJJK00094361', umlEcd: '', menuXpath: '' },
      ],
    });
    assert.equal(out.atoms.length, 1);
    const cand = out.atoms[0].functionIdCandidates || [];
    assert.ok(cand.some((c) => c.id === 9000000740 && c.reason === 'page_code'),
      `expected page_code candidate 9000000740, got ${JSON.stringify(cand)}`);
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('propose rejects reference-style steps (reference_step)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-'));
    cpSync(fixtureRoot, join(tmp, 'demo-mod'), { recursive: true });

    const fakeLLM = async () => JSON.stringify({
      atoms: [
        {
          chainId: 'chain-a',
          stepIndexes: [2],
          title: '回主链 A 第 6-9 步按需调整并启用',
          taskDraft: '1、回主链 A 第 6-9 步。\n\n来源：demo.docx\n',
          phaseHints: ['x'],
        },
      ],
    });
    const out = await proposeDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      callLLM: fakeLLM,
      listSystemsFn: async () => [],
    });
    assert.equal(out.atoms.length, 0);
    assert.ok(out.rejected.some((r) => r.reason === 'reference_step'));
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('propose marks atoms kind and truncation prefers write', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-'));
    cpSync(fixtureRoot, join(tmp, 'demo-mod'), { recursive: true });

    const fakeLLM = async () => JSON.stringify({
      atoms: [
        { chainId: 'chain-a', stepIndexes: [1], title: '进入产品库，加载产品树', taskDraft: '1、进入产品库。\n\n来源：demo.docx\n', phaseHints: ['x'] },
        { chainId: 'chain-a', stepIndexes: [2], title: '新增一级分类', taskDraft: '1、新增一级分类。\n\n来源：demo.docx\n', phaseHints: ['x'] },
        { chainId: 'chain-a', stepIndexes: [3], title: '选中分类下新增子分类', taskDraft: '1、选中分类下新增子分类。\n\n来源：demo.docx\n', phaseHints: ['x'] },
      ],
    });
    const out = await proposeDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      maxAtoms: 2,
      callLLM: fakeLLM,
      listSystemsFn: async () => [],
    });
    // LLM emitted nav + 2 writes; entry/nav fold merges nav into first write → 2 atoms, nothing dropped.
    assert.equal(out.atoms.length, 2);
    assert.ok(out.atoms.every((a) => a.kind === 'write' || a.kind === 'nav'));
    assert.equal(out.atoms.some((a) => a.title === '新增一级分类'), true);
    const firstWrite = out.atoms.find((a) => a.title === '新增一级分类');
    assert.ok(firstWrite);
    assert.match(firstWrite.taskDraft, /进入产品库/);
    assert.deepEqual(out.truncated, { dropped: 0, requestedMax: 2 });
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('propose omits candidates when suggestedFunctionId present', async () => {    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-'));
    cpSync(fixtureRoot, join(tmp, 'demo-mod'), { recursive: true });

    const fakeLLM = async () => JSON.stringify({
      atoms: [
        { chainId: 'chain-a', stepIndexes: [2], title: '新增一级分类', taskDraft: '1、新增一级分类。\n\n来源：demo.docx\n', phaseHints: ['x'], suggestedFunctionId: 9000000740 },
      ],
    });
    const out = await proposeDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      callLLM: fakeLLM,
      functionIdExists: async () => true,
      listSystemsFn: async () => [
        { id: 9000000740, type: 3, name: '产品库管理', pdCmptEcd: 'ZJJK00094361', umlEcd: '', menuXpath: '' },
      ],
    });
    assert.equal(out.atoms.length, 1);
    assert.equal(out.atoms[0].functionIdCandidates, undefined);
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('flow-card-guide selectRelevantFlowCards ranks stem hit', async () => {
    const guide = await import(pathToFileURL(join(ROOT, 'src/services/req-draft-traj/flow-card-guide.js')).href);
    const cards = [
      { _stem: 'other', flow: '其他', keywords: ['无关'], nodes: [] },
      { _stem: 'customer_onboarding', flow: '对公客户建档', keywords: ['信贷潜在客户', '草稿客户'], nodes: [{ id: 'edit_page', page: '编辑页' }] },
    ];
    const chains = [{ chainId: 'a', title: '草稿转信贷潜在', steps: [{ index: 1, action: '维护概况并保存为信贷潜在客户' }] }];
    const hit = guide.selectRelevantFlowCards({ chains, cards, limit: 2 });
    assert.equal(hit[0]._stem, 'customer_onboarding');
  });

  await runAsync('flow-card-guide stepsShareClosedLoop allows fill+verify+one save', async () => {
    const guide = await import(pathToFileURL(join(ROOT, 'src/services/req-draft-traj/flow-card-guide.js')).href);
    assert.equal(
      guide.stepsShareClosedLoop({
        stepActions: ['进入编辑页', '维护概况', '联网核查', '保存'],
      }),
      true,
    );
    assert.equal(
      guide.stepsShareClosedLoop({
        stepActions: ['保存概况', '提交审批'],
      }),
      false,
    );
  });

  const flowGuideFixtureRoot = join(ROOT, 'scripts/characterization/fixtures/req-draft-traj/flow-guide-mod');
  const miniFlowCard = JSON.parse(
    readFileSync(join(flowGuideFixtureRoot, 'flows/customer_onboarding_mini.json'), 'utf8'),
  );
  miniFlowCard._stem = 'customer_onboarding_mini';

  await runAsync('propose merges same-loop steps when LLM returns flowRef', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-flow-guide-'));
    cpSync(flowGuideFixtureRoot, join(tmp, 'flow-guide-mod'), { recursive: true });

    const fakeLLM = async (prompt) => {
      assert.match(prompt, /flowCards|customer_onboarding_mini/);
      return JSON.stringify({
        atoms: [{
          chainId: 'chain-a',
          stepIndexes: [1, 2, 3, 4],
          title: '草稿客户转为信贷潜在客户',
          flowRef: 'customer_onboarding_mini',
          nodeId: 'edit_page',
          taskDraft: '1、进入编辑页\n2、维护概况\n3、联网核查\n4、保存\n\n来源：<sourceDoc> / <sourceChapter>\n',
          phaseHints: ['进页', '保存'],
          pageCodes: [],
          suggestedFunctionId: null,
        }],
      });
    };

    const out = await proposeDraftTrajectories({
      moduleKey: 'flow-guide-mod',
      rootDir: tmp,
      callLLM: fakeLLM,
      listSystemsFn: async () => [],
      listFlowCardsFn: async () => [miniFlowCard],
    });
    assert.equal(out.atoms.length, 1);
    assert.equal(out.atoms[0].flowGuided, true);
    assert.equal(out.atoms[0].suggestedFlowRef, 'customer_onboarding_mini');
    assert.equal(out.rejected.filter((r) => r.reason === 'multi_write_atom').length, 0);
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('propose card-guided deterministic fallback merges to persist boundary', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-flow-fallback-guide-'));
    cpSync(flowGuideFixtureRoot, join(tmp, 'flow-guide-mod'), { recursive: true });

    const out = await proposeDraftTrajectories({
      moduleKey: 'flow-guide-mod',
      rootDir: tmp,
      callLLM: async () => { throw new Error('force fallback'); },
      listSystemsFn: async () => [],
      listFlowCardsFn: async () => [miniFlowCard],
    });
    assert.equal(out.atoms.length, 1);
    assert.equal(out.atoms[0].flowGuided, true);
    assert.equal(out.atoms[0].suggestedFlowRef, 'customer_onboarding_mini');
    assert.deepEqual(out.atoms[0].phaseHints.slice(0, 4), [
      '进入编辑页',
      '维护概况',
      '联网核查',
      '保存（信贷潜在客户）',
    ]);
    assert.match(out.atoms[0].taskDraft, /^1、进入编辑页/m);
    assert.doesNotMatch(out.atoms[0].taskDraft, /^1、进入编辑页[\s\S]*^2、进入编辑页/m);
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('propose fallback without cards sets flowGuided false', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-flow-fallback-'));
    cpSync(fixtureRoot, join(tmp, 'demo-mod'), { recursive: true });

    const out = await proposeDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      callLLM: async () => { throw new Error('force fallback'); },
      listSystemsFn: async () => [],
      listFlowCardsFn: async () => [],
    });
    assert.ok(out.atoms.length >= 1);
    assert.ok(out.atoms.every((a) => a.flowGuided === false));
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('propose rejects multi_write when LLM flowRef is unknown', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-flow-ref-unknown-'));
    cpSync(flowGuideFixtureRoot, join(tmp, 'flow-guide-mod'), { recursive: true });

    const fakeLLM = async () => JSON.stringify({
      atoms: [{
        chainId: 'chain-a',
        stepIndexes: [1, 2, 3, 4],
        title: '草稿客户转为信贷潜在客户',
        flowRef: 'invented_nonexistent_flow',
        nodeId: 'edit_page',
        taskDraft: '1、进入编辑页\n2、维护概况\n3、联网核查\n4、保存\n\n来源：<sourceDoc> / <sourceChapter>\n',
        phaseHints: ['进页', '保存'],
        pageCodes: [],
        suggestedFunctionId: null,
      }],
    });

    const out = await proposeDraftTrajectories({
      moduleKey: 'flow-guide-mod',
      rootDir: tmp,
      callLLM: fakeLLM,
      listSystemsFn: async () => [],
      listFlowCardsFn: async () => [miniFlowCard],
    });
    assert.equal(out.atoms.filter((a) => a.flowGuided === true).length, 0);
    assert.ok(out.rejected.some((r) => r.reason === 'multi_write_atom'));
    rmSync(tmp, { recursive: true, force: true });
  });

  await runAsync('propose card-guided fallback splits on two persist boundaries', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'req-draft-flow-two-persist-'));
    cpSync(flowGuideFixtureRoot, join(tmp, 'flow-guide-mod'), { recursive: true });
    const chainsPath = join(tmp, 'flow-guide-mod/through-chains.md');
    writeFileSync(chainsPath, `# 视图2：可贯通主链清单（flow-guide-mod）

### 主链 A：草稿客户转信贷潜在

- **章节出处**：章1 客户编辑

| # | 步骤 | 页面/弹窗 | ZJJK | 关键按钮 |
|---|------|-----------|------|----------|
| 1 | 进入编辑页 | 客户编辑页 | ZJJK00066158 | 【进入】 |
| 2 | 维护概况 | 客户编辑页 | ZJJK00066158 | 【保存概况】 |
| 3 | 保存（信贷潜在客户） | 客户编辑页 | ZJJK00066158 | 【保存】 |
| 4 | 提交审批 | 客户编辑页 | ZJJK00066158 | 【提交】 |
`, 'utf8');

    const out = await proposeDraftTrajectories({
      moduleKey: 'flow-guide-mod',
      rootDir: tmp,
      callLLM: async () => { throw new Error('force fallback'); },
      listSystemsFn: async () => [],
      listFlowCardsFn: async () => [miniFlowCard],
    });
    assert.equal(out.atoms.length, 2);
    assert.equal(out.atoms[0].flowGuided, true);
    assert.match(out.atoms[0].title, /保存/);
    assert.equal(out.atoms[1].title, '提交审批');
    rmSync(tmp, { recursive: true, force: true });
  });

  console.log(`OK ${passed}`);
}

main();
