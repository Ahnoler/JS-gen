/**
 * Characterization: flow-card recall helpers (getFlowCard, match, template hint).
 *
 * Run:
 *   node scripts/characterization/characterize-flow-card-recall.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
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
      buildFlowTemplateHint,
      applyFlowTemplateHintToDescription,
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

      const once = applyFlowTemplateHintToDescription('原阶段描述', hint);
      const twice = applyFlowTemplateHintToDescription(once, hint);
      assert.equal(once, twice);
      assert.ok(once.startsWith('【流程卡模板】'));
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

    console.log(`\ncharacterize-flow-card-recall: ${passed} passed`);
  } finally {
    rmSync(tmpFlows, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
