/**
 * Characterization: PR-LOC-HL 步骤级高亮数据层（真实 DB 断言）。
 *   node scripts/characterization/characterize-step-highlight.mjs
 *
 * 读 traj 38 phase 3（phase id 629）+ screenshot #8734 真实数据，验证：
 *   - loadPhaseData / matchStepToElement / resolveStepBoxes 纯函数对真实数据的行为
 *   - 旧数据（element_json 无 bbox）回退三维匹配的命中率
 *   - 纯函数边界：空 label 仍可因 kind 命中、非法 rect 被滤、region 空维度跳过、
 *     全空维度按未匹配处理、AND 语义（任一非空维度必须全等）
 *
 * 注意：traj 38 于 2026-08-17 22:49-22:54 重录，phase 629 现有 101 步（全有 element_json、
 * 0 bbox、0 region_id），与 brief 写稿时（112 步）不同；断言阈值已按当前真实数据调整
 * （steps≥100 / json≥100 / AND 命中率≥90% / label 命中≥90）。
 */
import { getDB } from '../../config/database.js';
import {
  loadPhaseData,
  matchStepToElement,
  resolveStepBoxes,
  normalizeStep,
  isLegalRect,
} from '../tools/lightup-step-highlight.mjs';

const TRAJ_ID = 38;
const PHASE_ID = 629;
const SHOT_ID = 8734;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function testRealDataLoad(db) {
  const data = await loadPhaseData(db, { trajectoryId: TRAJ_ID, phaseId: PHASE_ID, screenshotId: SHOT_ID });
  assert(data.screenshotId === SHOT_ID, `screenshotId=${data.screenshotId} must be ${SHOT_ID}`);
  assert(data.meta && Array.isArray(data.meta.elements), 'meta.elements must be an array');
  assert(data.meta.elements.length >= 150, `elements=${data.meta.elements.length} >= 150`);

  const steps = data.steps;
  const jsonSteps = steps.filter((s) => s.hasElementJson);
  const bboxSteps = steps.filter((s) => isLegalRect(s.bbox));
  console.log(`  steps total=${steps.length} | json=${jsonSteps.length} | bbox=${bboxSteps.length} | elements=${data.meta.elements.length}`);
  assert(steps.length >= 100, `steps total=${steps.length} >= 100`);
  assert(jsonSteps.length >= 100, `json steps=${jsonSteps.length} >= 100`);
  assert(bboxSteps.length === 0, `old data bbox steps=${bboxSteps.length} must be 0`);
  return { steps, elements: data.meta.elements };
}

async function testRealDataMatch(db, { steps, elements }) {
  const resolved = resolveStepBoxes(steps, elements);
  assert(resolved.length === steps.length, 'resolveStepBoxes returns one entry per step');

  const jsonSteps = steps.filter((s) => s.hasElementJson);
  const hitSteps = resolved.filter((r) => r.boxes.length > 0);
  const matchHits = hitSteps.filter((r) => r.boxes[0]?.source === 'match');
  const labelHits = matchHits.filter((r) => r.step.label).length;
  const andHits = matchHits.length;
  const rate = (andHits / jsonSteps.length) * 100;

  console.log(`  AND hits=${andHits}/${jsonSteps.length} (${rate.toFixed(1)}%) | label hits=${labelHits}`);
  assert(rate >= 90, `AND hit rate=${rate.toFixed(1)}% >= 90%`);
  assert(labelHits >= 90, `label hits=${labelHits} >= 90`);
  assert(matchHits.length === hitSteps.length, 'bbox=0 data: all hits must be fallback match');
}

async function testScreenshotSelection(db) {
  // 传 screenshotId 直查
  const byId = await loadPhaseData(db, { screenshotId: SHOT_ID });
  assert(byId.screenshotId === SHOT_ID, 'screenshotId direct query');
  // 未传 phaseId 时从 screenshot 行 trajectory_phase_id 反查
  assert(byId.steps.length >= 100, `phase derived from screenshot: steps=${byId.steps.length}`);

  // kind='phase_highlight' + trajectory_id 按 id 倒序取第一条
  const byTraj = await loadPhaseData(db, { trajectoryId: TRAJ_ID });
  assert(byTraj.screenshotId === SHOT_ID, `latest phase_highlight for traj ${TRAJ_ID} = #${byTraj.screenshotId}`);

  // + 可选 phaseId
  const byPhase = await loadPhaseData(db, { trajectoryId: TRAJ_ID, phaseId: PHASE_ID });
  assert(byPhase.screenshotId === SHOT_ID, `traj+phase screenshot = #${byPhase.screenshotId}`);
  assert(byPhase.steps.length >= 100, `traj+phase steps=${byPhase.steps.length}`);

  // 不存在的 screenshot → 空返回
  const none = await loadPhaseData(db, { screenshotId: 999999999 });
  assert(none.screenshotId === null && none.steps.length === 0, 'missing screenshot → empty result');
}

function testPureBoundaries() {
  const legal = { x1: 0, y1: 0, x2: 100, y2: 20 };

  // 1. 空 label 的 step 仍可因 kind 命中（AND：label 维度为空则跳过）
  const byKind = matchStepToElement(
    { label: '', kind: 'button', regionId: '' },
    [{ label: '其他控件', kind: 'button', rect: legal }],
  );
  assert(!!byKind && byKind.kind === 'button', 'empty label + matching kind → hit');

  // 2. 非法 rect（x2<=x1）的元素被跳过，取下一个合法 rect 元素
  const illegal = { x1: 0, y1: 0, x2: 0, y2: 20 }; // x2 <= x1
  const skipped = matchStepToElement(
    { label: '保存', kind: 'button', regionId: '' },
    [
      { label: '保存', kind: 'button', rect: illegal },
      { label: '保存', kind: 'button', rect: legal },
    ],
  );
  assert(!!skipped && isLegalRect(skipped.rect), 'illegal rect element skipped → second legal element hit');

  // 3. region 维度为空时跳过（旧数据 region_id 为空不影响匹配）
  const noRegion = matchStepToElement(
    { label: '客户编号', kind: 'form_input', regionId: '' },
    [{ label: '客户编号', kind: 'form_input', regionId: 'titlebox:基本信息', rect: legal }],
  );
  assert(!!noRegion, 'empty regionId dim skipped → still matches');

  // 4. 全空维度按未匹配处理（design 约定）
  const allEmpty = matchStepToElement(
    { label: '', kind: '', regionId: '' },
    [{ label: '客户编号', kind: 'form_input', regionId: '', rect: legal }],
  );
  assert(allEmpty === null, 'fully-empty step → unmatched');

  // 5. AND 语义：任一非空维度必须全等，否则不命中
  const kindMismatch = matchStepToElement(
    { label: '保存', kind: 'button', regionId: '' },
    [{ label: '保存', kind: 'form_input', rect: legal }],
  );
  assert(kindMismatch === null, 'label matches but kind differs → null (AND)');

  const labelMismatch = matchStepToElement(
    { label: '保存', kind: 'button', regionId: '' },
    [{ label: '提交', kind: 'button', rect: legal }],
  );
  assert(labelMismatch === null, 'label differs → null (AND)');

  const regionMismatch = matchStepToElement(
    { label: '客户编号', kind: 'form_input', regionId: 'titlebox:基本信息' },
    [{ label: '客户编号', kind: 'form_input', regionId: 'titlebox:其他', rect: legal }],
  );
  assert(regionMismatch === null, 'regionId differs → null (AND)');

  // 6. 同 label 命中多个元素 → 取第一个 rect 合法的
  const firstWins = matchStepToElement(
    { label: '客户名称', kind: 'form_input', regionId: '' },
    [
      { label: '客户名称', kind: 'form_input', regionId: '', rect: legal },
      { label: '客户名称', kind: 'form_input', regionId: '', rect: { x1: 200, y1: 0, x2: 300, y2: 20 } },
    ],
  );
  assert(firstWins && firstWins.rect.x2 === 100, 'same label multiple elements → first legal rect wins');

  // 7. resolveStepBoxes：bbox 直用 / 无 bbox 走 match / 未命中空 boxes
  const withBbox = normalizeStep(
    { id: 1, action_type: 'fill_form_field', params_json: { label: '姓名' }, element_json: { bbox: { x1: 1, y1: 2, x2: 101, y2: 22 }, text: '姓名' } },
    0,
  );
  const resolved = resolveStepBoxes(
    [
      withBbox,
      { ...normalizeStep({ id: 2, action_type: 'click_element_by_index', params_json: null, element_json: { text: '保存', target_kind: 'button' } }, 1) },
      { ...normalizeStep({ id: 3, action_type: 'click_element_by_index', params_json: null, element_json: null }, 2) },
    ],
    [{ label: '保存', kind: 'button', rect: legal }],
  );
  assert(resolved[0].boxes.length === 1 && resolved[0].boxes[0].source === 'bbox', 'bbox direct');
  assert(resolved[1].boxes.length === 1 && resolved[1].boxes[0].source === 'match', 'fallback match');
  assert(resolved[2].boxes.length === 0, 'unmatched step → empty boxes');

  // 8. normalizeStep：label 优先级 formLabel > text > matchedLabel；params 归一化
  const ns = normalizeStep(
    { id: 4, action_type: 'fill_form_field', params_json: '{"value":"张三"}', element_json: { formLabel: ' 姓名 ', text: '占位', matchedLabel: 'X', bbox: { x1: 1, y1: 1, x2: 1, y2: 2 } } },
    3,
  );
  assert(ns.label === '姓名', `label from formLabel (trim), got "${ns.label}"`);
  assert(ns.params && ns.params.value === '张三', 'params parsed from string JSON');
  assert(ns.bbox === null, 'illegal bbox (x2==x1) dropped');

  const ns2 = normalizeStep(
    { id: 5, action_type: 'x', params_json: null, element_json: '{"text":"菜单","target_kind":"menu"}' },
    4,
  );
  assert(ns2.label === '菜单' && ns2.kind === 'menu' && ns2.hasElementJson, 'element_json string parsed');
  assert(ns2.params === null, 'null params_json → params null');

  const ns3 = normalizeStep({ id: 6, action_type: 'x', params_json: 'not-json', element_json: 'bad{' }, 5);
  assert(ns3.hasElementJson === false && ns3.params === null, 'parse failure → no element json, params null');
}

async function main() {
  console.log('\n=== step-highlight data layer characterization ===\n');
  const db = getDB();
  let failed = 0;
  const run = async (name, fn) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${name} — ${err.message}`);
    }
  };

  try {
    console.log('[real data: traj 38 phase 3 / screenshot #8734]');
    let ctx = null;
    await run('load data', async () => {
      ctx = await testRealDataLoad(db);
    });
    if (ctx) {
      await run('AND match rate + label hits', () => testRealDataMatch(db, ctx));
    } else {
      failed += 1;
      console.error('  ✗ AND match rate — load data failed, skipped');
    }
    await run('screenshot selection', () => testScreenshotSelection(db));
    await run('pure function boundaries', testPureBoundaries);
  } finally {
    await db.destroy();
  }

  console.log(failed ? `\nFAILED (${failed})\n` : '\nOK\n');
  process.exit(failed ? 1 : 0);
}

main();
