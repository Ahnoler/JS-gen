/**
 * Characterization: flow-card recall helpers (getFlowCard, match, template hint).
 *
 * Run:
 *   node scripts/characterization/characterize-flow-card-recall.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
// F-B: keep observability writes out of the repo (data/kb/staging).
const OBSERVE_TMP = mkdtempSync(join(tmpdir(), 'kb-observe-'));
process.env.KB_STAGING_DIR = OBSERVE_TMP;
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

const CUSTOMER_ONBOARDING_CARD = {
  flow: '对公客户建档',
  aliases: ['对公客户管理'],
  keywords: ['客户转正', '草稿客户'],
  hash_markers: ['ZJJK00066153', 'FS00004007'],
  menu_path: '客户管理→对公客户管理',
  preconditions: [
    '入口：客户管理→对公客户管理',
    '客户转正：选择一个信贷预客户，点击修改，进入对公客户主页，点击客户转正',
    '草稿客户：选择一个草稿客户，点击修改，进入创建潜在客户基础页面',
  ],
  nodes: [
    { id: 'list', page: '对公客户管理列表页', enter: '菜单 客户管理→对公客户管理' },
    { id: 'convert', page: '客户转正场景', enter: '列表选信贷预客户→【修改】→对公客户主页→【客户转正】' },
  ],
};

async function main() {
  const tmpFlows = mkdtempSync(join(tmpdir(), 'flow-card-recall-'));
  mkdirSync(tmpFlows, { recursive: true });
  writeFileSync(
    join(tmpFlows, 'customer_onboarding.json'),
    JSON.stringify(CUSTOMER_ONBOARDING_CARD, null, 2),
    'utf-8',
  );

  try {
    const kbMod = await import(pathToFileURL(join(ROOT, 'src/services/kb-flow-cards.js')).href);
    const recallMod = await import(
      pathToFileURL(join(ROOT, 'src/services/req-draft-traj/flow-card-recall.js')).href,
    );

    const { getFlowCard } = kbMod;
    const {
      matchFlowForAtom,
      rankFlowCards,
      buildFlowTemplateHint,
      applyFlowTemplateHintToDescription,
      getFlowTemplateHintForTrajectory,
      tokenizeCodes,
      SYNONYM_WEIGHT,
    } = recallMod;

    await runAsync('getFlowCard reads card from temp dir', async () => {
      const card = await getFlowCard({ stem: 'customer_onboarding', dir: tmpFlows });
      assert.equal(card.flow, '对公客户建档');
    });

    await runAsync('matchFlowForAtom scores customer_onboarding + convert node', async () => {
      const card = await getFlowCard({ stem: 'customer_onboarding', dir: tmpFlows });
      const hit = matchFlowForAtom({
        title: '对公客户转正并补齐任务页信息',
        taskDraft: '1、在对公客户主页点击【客户转正】，进入 FS00004007。\n',
        cards: [{ ...card, _stem: 'customer_onboarding' }],
      });
      assert.equal(hit.flowRef, 'customer_onboarding');
      assert.equal(hit.nodeId, 'convert');
    });

    await runAsync('buildFlowTemplateHint layout and apply idempotency', async () => {
      const card = await getFlowCard({ stem: 'customer_onboarding', dir: tmpFlows });
      const hint = buildFlowTemplateHint({
        card,
        nodeId: 'convert',
        atomTask: '在对公客户主页点击【客户转正】',
      });
      assert.match(hint, /【流程卡模板】/);
      assert.match(hint, /客户转正：选择一个信贷预客户/);
      assert.match(hint, /【本段起点】/);
      assert.match(hint, /【本原子任务】/);
      assert.match(hint, /【\/流程卡模板】/);

      const once = applyFlowTemplateHintToDescription('原阶段描述', hint);
      const twice = applyFlowTemplateHintToDescription(once, hint);
      assert.equal(once, twice);
      assert.ok(once.startsWith('【流程卡模板】'));
    });

    await runAsync('applyFlowTemplateHint idempotent for multi-line atomTask', async () => {
      const card = await getFlowCard({ stem: 'customer_onboarding', dir: tmpFlows });
      const atomTask = [
        '1、在对公客户主页点击【客户转正】，进入 FS00004007。',
        '2、填写必填项并提交。',
        '来源：demo.docx / chapters/01-customer.md#对公客户管理',
      ].join('\n');
      const hint = buildFlowTemplateHint({
        card,
        nodeId: 'convert',
        atomTask,
      });
      const phaseText = '原阶段描述';

      const once = applyFlowTemplateHintToDescription(phaseText, hint);
      const twice = applyFlowTemplateHintToDescription(once, hint);
      assert.equal(once, twice);
      assert.equal((once.match(/来源：/g) || []).length, 1);
      assert.ok(once.endsWith(phaseText));

      const hint2 = buildFlowTemplateHint({
        card,
        nodeId: 'list',
        atomTask,
      });
      const reapplied = applyFlowTemplateHintToDescription(once, hint2);
      assert.match(reapplied, /node=list/);
      assert.equal((reapplied.match(/来源：/g) || []).length, 1);
      assert.ok(reapplied.endsWith(phaseText));
    });

    run('null card hint and no-match flowRef', () => {
      assert.equal(buildFlowTemplateHint({ card: null, nodeId: null, atomTask: 'x' }), null);
      const hit = matchFlowForAtom({
        title: '无关标题xyz',
        taskDraft: '',
        cards: [{ ...CUSTOMER_ONBOARDING_CARD, _stem: 'customer_onboarding' }],
      });
      assert.equal(hit.flowRef, null);
    });

    run('propose.js attaches suggestedFlowRef via matchFlowForAtom', () => {
      const proposePath = join(ROOT, 'src/services/req-draft-traj/propose.js');
      const src = readFileSync(proposePath, 'utf8');
      assert.match(src, /suggestedFlowRef/);
      assert.match(src, /matchFlowForAtom/);
    });

    run('prepare injects flow template hint into first phase', () => {
      const attachRunnerPath = join(ROOT, 'src/services/trajectory/trajectory-attach-runner.js');
      const attachRunnerSrc = readFileSync(attachRunnerPath, 'utf8');
      assert.match(attachRunnerSrc, /injectFlowTemplateHintIfNeeded|buildFlowTemplateHint/);
      assert.match(attachRunnerSrc, /kbFlowRef/);
    });

    run('trajectory route registers flow-template-hint preview', () => {
      const routePath = join(ROOT, 'src/routes/v2/trajectory.js');
      const routeSrc = readFileSync(routePath, 'utf8');
      assert.match(routeSrc, /flow-template-hint/);
      assert.match(routeSrc, /getFlowTemplateHintForTrajectory/);
    });

    await runAsync('getFlowTemplateHintForTrajectory builds hint from traj fixture', async () => {
      const out = await getFlowTemplateHintForTrajectory(99, {
        getById: async () => ({
          id: 99,
          kbFlowRef: 'customer_onboarding',
          kbFlowNodeId: 'convert',
          task: '在对公客户主页点击【客户转正】',
        }),
      });
      assert.equal(out.kbFlowRef, 'customer_onboarding');
      assert.equal(out.kbFlowNodeId, 'convert');
      assert.match(out.hint, /【流程卡模板】/);
      assert.match(out.hint, /【本原子任务】/);
    });

    await runAsync('getFlowTemplateHintForTrajectory null hint when no ref', async () => {
      const out = await getFlowTemplateHintForTrajectory(1, {
        getById: async () => ({
          id: 1,
          kbFlowRef: null,
          kbFlowNodeId: null,
          task: '无关任务',
        }),
      });
      assert.equal(out.hint, null);
      assert.equal(out.kbFlowRef, null);
      assert.equal(out.kbFlowNodeId, null);
    });

    const { writeProposeCache } = await import(
      pathToFileURL(join(ROOT, 'src/services/req-draft-traj/propose-cache.js')).href,
    );
    const { commitDraftTrajectories } = await import(
      pathToFileURL(join(ROOT, 'src/services/req-draft-traj/commit.js')).href,
    );

    const seedFlowCommitCache = async (modDir, atoms) => {
      const md = '### 主链 A：客户\n\n| # | 步骤 | 页面 | ZJJK | 按钮 |\n|---|---|---|---|---|\n| 1 | 客户转正 | 对公客户主页 | ZJJK00000001 | 转正 |\n';
      writeFileSync(join(modDir, 'through-chains.md'), md, 'utf8');
      const sourceHash = createHash('sha256').update(md, 'utf8').digest('hex');
      await writeProposeCache(modDir, { atoms, rejected: [], sourceHash });
    };

    await runAsync('commitDraftTrajectories persists suggestedFlowRef as kbFlowRef', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'flow-card-commit-'));
      const modDir = join(tmp, 'demo-mod');
      mkdirSync(modDir, { recursive: true });
      const atomKey = 'demo-mod:chain-a:1:客户转正';
      await seedFlowCommitCache(modDir, [{
        atomKey,
        title: '客户转正',
        suggestedFunctionId: 9000000740,
        suggestedFlowRef: 'customer_onboarding',
        suggestedNodeId: 'convert',
        sourceDoc: 'demo.docx',
        sourceChapter: 'chapters/01-customer.md#对公客户管理',
        taskDraft: '在对公客户主页点击【客户转正】。',
      }]);

      let createOpts;
      const out = await commitDraftTrajectories({
        moduleKey: 'demo-mod',
        rootDir: tmp,
        atomKeys: [atomKey],
        analyzeFn: async () => ({ phases: ['x'], businessEntries: [] }),
        createFn: async (opts) => {
          createOpts = opts;
          return { id: 4242 };
        },
        findDraftFn: async () => null,
        functionIdExists: async () => true,
      });
      assert.equal(out.created.length, 1);
      assert.equal(createOpts.kbFlowRef, 'customer_onboarding');
      assert.equal(createOpts.kbFlowNodeId, 'convert');
      rmSync(tmp, { recursive: true, force: true });
    });

    await runAsync('commitDraftTrajectories flowRefOverrides win over atom suggestions', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'flow-card-commit-'));
      const modDir = join(tmp, 'demo-mod');
      mkdirSync(modDir, { recursive: true });
      const atomKey = 'demo-mod:chain-a:1:客户转正';
      await seedFlowCommitCache(modDir, [{
        atomKey,
        title: '客户转正',
        suggestedFunctionId: 9000000740,
        suggestedFlowRef: 'customer_onboarding',
        suggestedNodeId: 'convert',
        sourceDoc: 'demo.docx',
        sourceChapter: 'chapters/01-customer.md#对公客户管理',
        taskDraft: '在对公客户主页点击【客户转正】。',
      }]);

      let createOpts;
      await commitDraftTrajectories({
        moduleKey: 'demo-mod',
        rootDir: tmp,
        atomKeys: [atomKey],
        flowRefOverrides: {
          [atomKey]: { kbFlowRef: 'product_library', kbFlowNodeId: 'add_category' },
        },
        analyzeFn: async () => ({ phases: ['x'], businessEntries: [] }),
        createFn: async (opts) => {
          createOpts = opts;
          return { id: 4242 };
        },
        findDraftFn: async () => null,
        functionIdExists: async () => true,
      });
      assert.equal(createOpts.kbFlowRef, 'product_library');
      assert.equal(createOpts.kbFlowNodeId, 'add_category');
      rmSync(tmp, { recursive: true, force: true });
    });

    // Cross-language golden fixture (shared contract with scripts/kb/recall.py):
    // JS side asserts flowRef (+ nodeId where pinned) against the real corpus.
    const golden = JSON.parse(
      readFileSync(join(ROOT, 'scripts/characterization/fixtures/kb-recall-golden.json'), 'utf8'),
    );
    const realCards = await kbMod.listFlowCardsDetailed({});
    assert.ok(realCards.length >= 50, `expected real flow corpus, got ${realCards.length}`);

    await runAsync(`golden fixture: ${golden.entries.length} queries match real corpus`, async () => {
      for (const entry of golden.entries) {
        const hit = matchFlowForAtom({ title: entry.query, taskDraft: '', cards: realCards });
        assert.equal(
          hit.flowRef,
          entry.expectFlowRef,
          `query="${entry.query}" expected flowRef=${entry.expectFlowRef} got ${hit.flowRef}`,
        );
        if (entry.expectNodeId != null) {
          assert.equal(hit.nodeId, entry.expectNodeId, `query="${entry.query}" nodeId`);
        }
        if (entry.forbidNodeId != null) {
          assert.notEqual(hit.nodeId, entry.forbidNodeId, `query="${entry.query}" nodeId must not be ${entry.forbidNodeId}`);
        }
      }
    });

    await runAsync('matchFlowForAtom exposes winning card score (F-C)', async () => {
      const hit = matchFlowForAtom({ title: '查询产品列表', taskDraft: '', cards: realCards });
      assert.equal(typeof hit.score, 'number');
      assert.ok(hit.score > 0);
      const miss = matchFlowForAtom({ title: '今天天气不错，我们去吃饭吧', taskDraft: '', cards: realCards });
      assert.equal(miss.flowRef, null);
      assert.equal(miss.score, null);
    });

    await runAsync('rankFlowCards top-1 matches matchFlowForAtom', async () => {
      const ranked = rankFlowCards({ title: '查询产品列表', taskDraft: '', cards: realCards, k: 5 });
      const single = matchFlowForAtom({ title: '查询产品列表', taskDraft: '', cards: realCards });
      assert.equal(ranked.flowRef, single.flowRef);
      assert.equal(ranked.nodeId, single.nodeId);
      assert.equal(ranked.score, single.score);
      assert.equal(ranked.candidates[0].flowRef, single.flowRef);
      assert.equal(ranked.candidates[0].score, single.score);
      assert.ok(ranked.candidates.length <= 5);
      const scores = ranked.candidates.map((c) => c.score);
      assert.deepEqual(scores, scores.slice().sort((a, b) => b - a), 'candidates must be score-desc');
    });

    await runAsync('rankFlowCards returns empty candidates on no-hit', async () => {
      const r = rankFlowCards({ title: '写一首关于春天的诗', taskDraft: '', cards: realCards, k: 5 });
      assert.equal(r.flowRef, null);
      assert.equal(r.score, null);
      assert.deepEqual(r.candidates, []);
    });

    await runAsync('code tokenizer splits camelCase and keeps whole token', async () => {
      const t = tokenizeCodes('enqrPdInf');
      assert.ok(t.has('enqrpdinf'), 'whole token kept (lowercased)');
      for (const part of ['enqr', 'pd', 'inf']) assert.ok(t.has(part), 'camelCase part ' + part);
      assert.ok(tokenizeCodes('W0').has('w0'), 'letter+digit run kept whole');
      assert.ok(!tokenizeCodes('计算 2 加 3').has('2') && !tokenizeCodes('计算 2 加 3').has('3'), 'single chars dropped (no FP fuel)');
    });

    await runAsync('ASCII short-code query reaches its gold card (D-001 regression)', async () => {
      const hit = matchFlowForAtom({ title: 'W0', taskDraft: '', cards: realCards });
      assert.equal(hit.flowRef, 'session_login');
    });

    await runAsync('node-ratio denominator ignores card-level-only tokens (hash_markers code)', async () => {
      // 卡级独占码场景（recall P0 收尾 pin）：FS/ZJJK 码只活在 hash_markers，
      // 任何节点的 id/page/enter 都不可表达 → 分母必须排除该权重（nodeEligibleScore），
      // 否则 NODE_SCORE_RATIO 被抬高、正确节点被误杀 nodeId=null。
      // 曾因 T2 分词激活码 token 后触发（'对公客户转正并补齐任务页信息'→convert 误杀），此 pin 防回归。
      const card = {
        _stem: 'code_card',
        flow: '转正操作卡',
        keywords: ['转正'],
        hash_markers: ['FS00004007'],
        nodes: [
          { id: 'list', page: '转正列表页', enter: '菜单 转正管理' },
          { id: 'convert', page: '客户转正场景', enter: '列表选客户→【修改】→【客户转正】' },
        ],
      };
      const hit = matchFlowForAtom({
        title: '对公客户转正并补齐任务页信息',
        taskDraft: '1、在对公客户主页点击【客户转正】，进入 FS00004007。\n',
        cards: [card],
      });
      assert.equal(hit.flowRef, 'code_card');
      assert.equal(hit.nodeId, 'convert',
        'code living only in hash_markers must not inflate the node-ratio denominator');
    });

    await runAsync('synonym expansion bridges query word to card vocabulary', async () => {
      const cards = [
        { _stem: 'limit_card', flow: '额度管控卡', aliases: ['额度冻结', '额度解冻'], keywords: ['额度冻结', '额度解冻', '部分冻结', '风险冻结'] },
        { _stem: 'other_a', flow: '机构维护卡', aliases: ['机构信息'], keywords: ['机构维护', '机构调整'] },
        { _stem: 'other_b', flow: '参数配置卡', aliases: ['参数管理'], keywords: ['参数配置', '参数生效'] },
      ];
      const synonyms = [{ term: '止付', expand: ['冻结'], scope: null, source: 'pin' }];
      const off = matchFlowForAtom({ title: '额度临时止付再恢复', taskDraft: '', cards });
      const on = matchFlowForAtom({ title: '额度临时止付再恢复', taskDraft: '', cards, synonyms });
      assert.equal(on.flowRef, 'limit_card', 'expansion must bridge 止付→冻结');
      assert.ok(typeof SYNONYM_WEIGHT === 'number' && SYNONYM_WEIGHT > 0 && SYNONYM_WEIGHT < 1,
        `SYNONYM_WEIGHT must be a (0,1) factor, got ${SYNONYM_WEIGHT}`);
      assert.notEqual(off.flowRef, null, 'sanity: unexpanded query still ranks the card via 额度');
      assert.ok(on.score >= off.score, 'additive expansion never lowers the same-card score');
    });

    await runAsync('synonym scope mismatch blocks injection', async () => {
      const cards = [{ _stem: 'limit_card', flow: '额度管控卡', aliases: ['额度冻结'], keywords: ['额度冻结'] }];
      const synonyms = [{ term: '止付', expand: ['冻结'], scope: 'other-module', source: 'pin' }];
      const hit = matchFlowForAtom({ title: '额度临时止付再恢复', taskDraft: '', cards, synonyms, moduleKey: 'customer-mgmt' });
      assert.equal(hit.flowRef, null, 'scoped entry must not fire for a non-matching module');
      const allowed = matchFlowForAtom({ title: '额度临时止付再恢复', taskDraft: '', cards, synonyms, moduleKey: 'other-module' });
      assert.equal(allowed.flowRef, 'limit_card', 'scoped entry fires when moduleKey matches');
    });

    await runAsync('synonyms absent => identical to legacy ranking', async () => {
      const cards = [{ _stem: 'a', flow: '冻结申请操作', keywords: ['冻结', '申请'] }];
      const without = rankFlowCards({ title: '冻结申请操作', taskDraft: '', cards, k: 3 });
      const explicitNull = rankFlowCards({ title: '冻结申请操作', taskDraft: '', cards, k: 3, synonyms: undefined });
      assert.deepEqual(without, explicitNull);
    });

    await runAsync('recall perf: 800-char single query under 200ms', async () => {
      const long = '维'.repeat(800);
      const t0 = Date.now();
      matchFlowForAtom({ title: '', taskDraft: long, cards: realCards });
      const ms = Date.now() - t0;
      assert.ok(ms < 200, `800-char recall took ${ms}ms (budget 200ms)`);
    });

    console.log(`\ncharacterize-flow-card-recall: ${passed} passed`);
  } finally {
    rmSync(tmpFlows, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
