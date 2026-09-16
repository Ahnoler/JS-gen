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

await run('propose flowGuided L1+child+product with 【确定】 each → multi_write_atom', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'req-draft-persist-multi-write-'));
  cpSync(demoRoot, join(tmp, 'demo-mod'), { recursive: true });
  writeFileSync(join(tmp, 'demo-mod/through-chains.md'), `# 视图2：可贯通主链清单（demo-mod）

### 主链 A：产品建库原子示例

- **章节出处**：§产品库管理（ZJJK00110131）

| # | 步骤 | 页面/弹窗 | ZJJK | 关键按钮 |
|---|------|-----------|------|----------|
| 1 | 进入产品库，加载产品树 | 产品库管理主页 | ZJJK00110131 | 【刷新产品树】 |
| 2 | 新增一级分类（父层级空，层级=1） | 新增产品弹窗 | ZJJK00094361 | 【新增一级分类】→【确定】 |
| 3 | 选中分类下新增子分类 | 同上 | ZJJK00094361 | 【新增分类】/【新增子分类】→【确定】 |
| 4 | 分类下新增产品（叶子；类型=基础产品；状态=未启用；V-0.0.1；填 pdDsc） | 同上 | ZJJK00094361 | 【新增产品】→【确定】 |
`, 'utf8');

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

if (failed) process.exit(1);
console.log('all passed');
