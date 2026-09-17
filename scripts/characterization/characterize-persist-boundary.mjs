#!/usr/bin/env node
/**
 * Persist-boundary pins for wet propose: buttons/确定 count as persist,
 * 未启用 must not match 启用, and taskDraft with multiple 【确定】 rejects.
 *
 * Run:
 *   node scripts/characterization/characterize-persist-boundary.mjs
 */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
process.env.KB_STAGING_DIR = mkdtempSync(join(tmpdir(), 'kb-observe-persist-'));

const guide = await import(
  pathToFileURL(join(ROOT, 'src/services/req-draft-traj/flow-card-guide.js')).href
);
const { proposeDraftTrajectories } = await import(
  pathToFileURL(join(ROOT, 'src/services/req-draft-traj/propose.js')).href
);

const demoRoot = join(ROOT, 'scripts/characterization/fixtures/req-draft-traj/demo-mod');

const PRODUCT_LIBRARY_WRITES = [
  {
    action: '新增一级分类（父层级空，层级=1）',
    buttons: '【新增一级分类】→【确定】',
  },
  {
    action: '选中分类下新增子分类',
    buttons: '【新增分类】/【新增子分类】→【确定】',
  },
  {
    action: '分类下新增产品（叶子；类型=基础产品；状态=未启用；V-0.0.1；填 pdDsc）',
    buttons: '【新增产品】→【确定】',
  },
];

const PRODUCT_LIBRARY_CARD = {
  _stem: 'product_library',
  flow: '产品库管理',
  keywords: ['新增一级分类', '新增产品'],
  menu_path: '产品管理→产品信息管理→产品库管理',
  preconditions: [],
  nodes: [{
    id: 'prod_add_dlg',
    page: '新增产品弹窗',
    enter: '从产品树新增',
    buttons: ['确定'],
    fields: ['名称'],
  }],
};

const THREE_CONFIRM_DRAFT = [
  '1、新增一级分类，操作：【新增一级分类】→【确定】',
  '2、选中分类下新增子分类，操作：【新增分类】→【确定】',
  '3、分类下新增产品，操作：【新增产品】→【确定】',
  '',
  '来源：demo.docx / chapters/01-product-library.md',
  '',
].join('\n');

const PRODUCT_LIBRARY_CHAIN_MD = `# 视图2：可贯通主链清单（demo-mod）

### 主链 A：产品建库原子示例

- **章节出处**：§产品库管理（ZJJK00110131）

| # | 步骤 | 页面/弹窗 | ZJJK | 关键按钮 |
|---|------|-----------|------|----------|
| 1 | 进入产品库，加载产品树 | 产品库管理主页 | ZJJK00110131 | 【刷新产品树】 |
| 2 | 新增一级分类（父层级空，层级=1） | 新增产品弹窗 | ZJJK00094361 | 【新增一级分类】→【确定】 |
| 3 | 选中分类下新增子分类 | 同上 | ZJJK00094361 | 【新增分类】/【新增子分类】→【确定】 |
| 4 | 分类下新增产品（叶子；类型=基础产品；状态=未启用；V-0.0.1；填 pdDsc） | 同上 | ZJJK00094361 | 【新增产品】→【确定】 |
`;

let failed = 0;
async function run(name, fn) {
  try {
    await fn();
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  FAIL - ${name}: ${e.message}`);
  }
}

console.log('characterize-persist-boundary');

await run('【确定】 is a persist boundary', () => {
  assert.equal(guide.isPersistBoundaryAction('【确定】'), true);
  assert.equal(guide.isPersistBoundaryAction('确定'), true);
});

await run('未启用 alone is not persist via 启用', () => {
  assert.equal(guide.isPersistBoundaryAction('未启用'), false);
  assert.equal(guide.isPersistBoundaryAction('已启用'), false);
  assert.equal(guide.isPersistBoundaryAction('启用'), true);
  assert.equal(guide.isPersistBoundaryAction('【启用】'), true);
});

await run('保存概况 as action is persist; as fill-step button is not', () => {
  assert.equal(guide.isPersistBoundaryAction('保存概况'), true);
  assert.equal(guide.isPersistBoundaryAction('保存'), true);
  assert.equal(
    guide.isPersistBoundaryAction({ action: '维护概况', buttons: '【保存概况】' }),
    false,
  );
  assert.equal(
    guide.isPersistBoundaryAction({ action: '新增一级分类', buttons: '【新增一级分类】→【确定】' }),
    true,
  );
});

await run('stepsShareClosedLoop false for three product-library writes with 【确定】 buttons', () => {
  assert.equal(
    guide.stepsShareClosedLoop({ stepActions: PRODUCT_LIBRARY_WRITES }),
    false,
  );
});

await run('stepsShareClosedLoop still allows fill+verify+one save (action-only)', () => {
  assert.equal(
    guide.stepsShareClosedLoop({
      stepActions: ['进入编辑页', '维护概况', '联网核查', '保存'],
    }),
    true,
  );
});

await run('countPersistConfirms: three 【确定】 lines', () => {
  assert.equal(typeof guide.countPersistConfirms, 'function');
  assert.equal(guide.countPersistConfirms(THREE_CONFIRM_DRAFT), 3);
  assert.equal(guide.countPersistConfirms('1、进入编辑页\n2、维护概况\n3、保存\n'), 1);
});

await run('countPersistConfirms: 启用 + 确定执行此操作 is not multi-persist', () => {
  assert.ok(
    guide.countPersistConfirms('1、启用产品，操作：【启用】\n2、确认：确定执行此操作？\n') <= 1,
    'bare 启用 / dialog 确定 copy must not inflate persist confirms',
  );
  assert.equal(
    guide.countPersistConfirms('1、维护概况，操作：【保存概况】\n2、保存（信贷潜在客户），操作：【保存】\n'),
    1,
  );
});

const WET_CREATE_FACTOR_GROUP = [
  '1、进入产品要素分组主页【ZJJK00094373】，等待加载',
  '2、在左侧树选中「产品公共要素」或「产品个性化要素」根节点',
  '3、点击【新增类型】，打开“要素类型”弹窗并自动带入上级分组编号',
  '4、录入组件名称与序号，点击【保存】成功',
].join('\n');

const WET_CREATE_PRODUCT = [
  '1、进入产品库管理主页【ZJJK00110131】，等待加载',
  '2、定位并选中已有产品分类目录',
  '3、点击【新增产品】，打开新增产品页【ZJJK00094361】',
  '4、系统自动生成编号，选择上级分类目录，填写名称与序号',
  '5、点击【确定】保存成功，首次版本号 V-0.0.1',
].join('\n');

const WET_DISABLE_PRODUCT = [
  '1、进入产品库管理主页【ZJJK00110131】，等待加载',
  '2、搜索/定位并选中启用状态产品',
  '3、点击【禁用】，进入产品下架页【ZJJK00101226】',
  '4、选择禁用理由，二次确认借据余额',
  '5、点击【确定】保存成功',
].join('\n');

const WET_CLONE_PRODUCT = [
  '1、进入产品库管理主页【ZJJK00110131】，等待加载',
  '2、定位并选中已有产品',
  '3、点击【产品克隆】，进入产品克隆页【ZJJK00097067】',
  '4、输入新产品名称',
  '5、点击【确定】完成克隆',
].join('\n');

await run('countPersistConfirms: wet product-mgmt A/B/C/D each have one closer', () => {
  assert.equal(guide.countPersistConfirms(WET_CREATE_FACTOR_GROUP), 1);
  assert.equal(guide.countPersistConfirms(WET_CREATE_PRODUCT), 1);
  assert.equal(guide.countPersistConfirms(WET_DISABLE_PRODUCT), 1);
  assert.equal(guide.countPersistConfirms(WET_CLONE_PRODUCT), 1);
});

await run('countPersistConfirms: two 【保存】 on one line (prose + 操作) is one persist', () => {
  assert.equal(
    guide.countPersistConfirms('1、选类型→录证件→【保存】（新增页），操作：【保存】\n'),
    1,
  );
});

await run('countPersistConfirms: two distinct 【保存】/【确定】 loops still multi', () => {
  assert.equal(
    guide.countPersistConfirms('1、填写甲并【保存】成功\n2、填写乙并【确定】成功\n'),
    2,
  );
});

await run('stepsShareClosedLoop object-shaped fill+保存概况+one 保存 still closed', () => {
  assert.equal(
    guide.stepsShareClosedLoop({
      stepActions: [
        { action: '进入编辑页', buttons: '【进入】' },
        { action: '维护概况', buttons: '【保存概况】' },
        { action: '联网核查', buttons: '【联网核查】' },
        { action: '保存（信贷潜在客户）', buttons: '【保存】' },
      ],
    }),
    true,
  );
});

await run('propose flowGuided L1+child+product with 【确定】 each → multi_write_atom', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'req-draft-persist-multi-write-'));
  cpSync(demoRoot, join(tmp, 'demo-mod'), { recursive: true });
  writeFileSync(join(tmp, 'demo-mod/through-chains.md'), PRODUCT_LIBRARY_CHAIN_MD, 'utf8');

  const fakeLLM = async () => JSON.stringify({
    atoms: [{
      chainId: 'chain-a',
      stepIndexes: [2, 3, 4],
      title: '新增产品（含分类）',
      flowRef: 'product_library',
      nodeId: 'prod_add_dlg',
      taskDraft: '1、新增一级分类。\n\n来源：demo.docx / chapters/01-product-library.md\n',
      phaseHints: ['新增一级分类'],
      suggestedFunctionId: null,
    }],
  });

  const out = await proposeDraftTrajectories({
    moduleKey: 'demo-mod',
    rootDir: tmp,
    callLLM: fakeLLM,
    listSystemsFn: async () => [],
    listFlowCardsFn: async () => [PRODUCT_LIBRARY_CARD],
  });
  rmSync(tmp, { recursive: true, force: true });
  assert.ok(
    out.rejected.some((r) => r.reason === 'multi_write_atom'),
    `expected multi_write_atom, got rejected=${JSON.stringify(out.rejected)} atoms=${out.atoms.length}`,
  );
});

await run('propose taskDraft with three 【确定】 lines → multi_persist_task_draft', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'req-draft-persist-task-draft-'));
  cpSync(demoRoot, join(tmp, 'demo-mod'), { recursive: true });

  const fakeLLM = async () => JSON.stringify({
    atoms: [{
      chainId: 'chain-a',
      stepIndexes: [2],
      title: '新增一级分类',
      flowRef: 'product_library',
      nodeId: 'prod_add_dlg',
      taskDraft: THREE_CONFIRM_DRAFT,
      phaseHints: ['新增一级分类'],
      suggestedFunctionId: null,
    }],
  });

  const out = await proposeDraftTrajectories({
    moduleKey: 'demo-mod',
    rootDir: tmp,
    callLLM: fakeLLM,
    listSystemsFn: async () => [],
    listFlowCardsFn: async () => [PRODUCT_LIBRARY_CARD],
  });
  rmSync(tmp, { recursive: true, force: true });
  assert.ok(
    out.rejected.some((r) => r.reason === 'multi_persist_task_draft'),
    `expected multi_persist_task_draft, got rejected=${JSON.stringify(out.rejected)} atoms=${out.atoms.length}`,
  );
});

await run('propose card-guided fallback splits three 【确定】 writes', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'req-draft-persist-fallback-split-'));
  cpSync(demoRoot, join(tmp, 'demo-mod'), { recursive: true });
  writeFileSync(join(tmp, 'demo-mod/through-chains.md'), PRODUCT_LIBRARY_CHAIN_MD, 'utf8');

  const out = await proposeDraftTrajectories({
    moduleKey: 'demo-mod',
    rootDir: tmp,
    callLLM: async () => { throw new Error('force fallback'); },
    listSystemsFn: async () => [],
    listFlowCardsFn: async () => [PRODUCT_LIBRARY_CARD],
  });
  rmSync(tmp, { recursive: true, force: true });
  const writeAtoms = out.atoms.filter((a) => a.kind === 'write');
  assert.equal(writeAtoms.length, 3, `expected 3 write atoms, got ${writeAtoms.length} atoms=${out.atoms.length} rejected=${JSON.stringify(out.rejected)}`);
  assert.ok(
    writeAtoms.every((a) => a.flowGuided === true && a.suggestedFlowRef === 'product_library'),
    `expected flowGuided product_library writes, got ${JSON.stringify(writeAtoms.map((a) => ({ key: a.atomKey, flowGuided: a.flowGuided, ref: a.suggestedFlowRef })))}`,
  );
  assert.equal(out.rejected.filter((r) => r.reason === 'multi_write_atom').length, 0);
});

if (failed) process.exit(1);
console.log('all passed');
