#!/usr/bin/env node
/**
 * Characterization for G3 control-plane phase_done evidence gate helpers.
 */
import assert from 'node:assert/strict';
import {
  aggregateTrajectorySuccessful,
  applyZeroStepFakeSuccessGate,
  collectFailedPhases,
  countBusinessSteps,
  evaluateFinalVerdict,
  evaluateFinalizeGate,
  evaluatePhaseOutcome,
  isBlockedOnlyFailure,
} from '../../src/services/trajectory/phase-done-evidence-gate.js';
import { META_STEP_ACTIONS } from '../../src/models/meta-step-actions.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

assert.equal(
  countBusinessSteps([
    { actionType: 'click_element_by_index' },
    { actionType: 'get_page_state' },
    { action_type: 'fill_form_field' },
  ], META_STEP_ACTIONS),
  2,
  'meta get_page_state excluded',
);

const ok = applyZeroStepFakeSuccessGate({
  stepCount: 2,
  donePayload: { success: true, text: 'done' },
});
assert.equal(ok.success, true);
assert.equal(ok.rejectedZeroStep, false);

const z = applyZeroStepFakeSuccessGate({
  stepCount: 0,
  donePayload: { success: true, text: '假完成' },
});
assert.equal(z.success, false);
assert.equal(z.rejectedZeroStep, true);
assert.ok(String(z.text).startsWith('zero_step_rejected:'));

const honestFail = applyZeroStepFakeSuccessGate({
  stepCount: 0,
  donePayload: { success: false, text: 'budget' },
});
assert.equal(honestFail.success, false);
assert.equal(honestFail.rejectedZeroStep, false);

const o1 = { success: true, text: 'a' };
const o2 = { success: false, text: 'b' };
assert.equal(aggregateTrajectorySuccessful({ 1: o1, 101: o1 }), true);
assert.equal(aggregateTrajectorySuccessful({ 1: o1, 101: o1, 2: o2, 102: o2 }), false);
assert.equal(aggregateTrajectorySuccessful({ 1: { success: null } }), true);

const runner = readFileSync(
  join(ROOT, 'src/services/trajectory/trajectory-recording-runner.js'),
  'utf8',
);
assert.ok(runner.includes('applyZeroStepFakeSuccessGate'), 'runner wires zero-step gate');
assert.ok(runner.includes('aggregateTrajectorySuccessful'), 'runner aggregates isSuccessful');
assert.ok(runner.includes('zero_step_rejected') || runner.includes('rejectedZeroStep'), 'zero-step log path');

// ── Step 1 收敛（2026-09-19）：三代判定纯函数化后的行为等价契约 ──────────────
// v1 阶段级 → evaluatePhaseOutcome；v2/v1.5/v3 门闩 → evaluateFinalizeGate；
// v3 同步终局 → collectFailedPhases + evaluateFinalVerdict。判定语义在此钉死，
// 防止三代再杂交；runner 只留 IO + CAS + broadcast。
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. evaluatePhaseOutcome：v1 阶段级判定（recordPhaseResult 收敛源）
const r1 = evaluatePhaseOutcome({ explicitSuccess: true, phaseStepCount: 0, donePayload: { text: '全部填完' } });
assert.ok(
  r1.success === null && r1.text === '[0步完成] 全部填完' && r1.registerPerRun === true && r1.zeroStepPhase === true,
  `1a 0步自报成功→降级null+[0步完成]+登记; got ${JSON.stringify(r1)}`,
);

const r2 = evaluatePhaseOutcome({ explicitSuccess: false, phaseStepCount: 0, donePayload: {} });
assert.ok(
  r2.success === false && r2.zeroStepPhase === true && r2.registerPerRun === false,
  '1b 0步诚实失败→不降级',
);

const r3 = evaluatePhaseOutcome({ explicitSuccess: true, phaseStepCount: 3, donePayload: { text: 'ok' } });
assert.ok(r3.success === true && r3.text === 'ok' && !r3.registerPerRun, '1c 有步自报成功→原样通过');

const r4 = evaluatePhaseOutcome({ explicitSuccess: null, phaseStepCount: 2, donePayload: {} });
assert.ok(r4.success === null && r4.text === '见页面当前状态', '1d success缺失→unknown+默认文案');

const r5 = evaluatePhaseOutcome({ explicitSuccess: null, phaseStepCount: 0, donePayload: { name: '阶段名' } });
assert.ok(r5.success === null && r5.text === '[0步完成] 见页面当前状态' && r5.registerPerRun === false,
  '1e 0步+success缺失→name 分支不参与（success缺失恒走「见页面当前状态」，忠实旧三元）');

const r6 = evaluatePhaseOutcome({ explicitSuccess: null, phaseStepCount: 0, donePayload: {} });
assert.equal(r6.text, '[0步完成] 见页面当前状态', '1f 0步+全空负载→兜底文案');

// 2. evaluateFinalizeGate：三代判定序 + 互斥/独立结构
const dZero = evaluateFinalizeGate({
  hasPhaseSuspects: true, totalCopySteps: 5, totalDbSteps: 5,
  zeroPhaseBoth: [2, 3], perRunZeroPhases: [],
});
assert.ok(
  dZero.zeroStepGate.verdict === 'downgrade' && dZero.zeroStepGate.kind === 'zeroPhase'
  && eq(dZero.zeroStepGate.phases, [2, 3]),
  '2a v2优先：双源0→downgrade zeroPhase',
);

const dTotal = evaluateFinalizeGate({
  hasPhaseSuspects: false, totalCopySteps: 0, totalDbSteps: 0,
  zeroPhaseBoth: [], perRunZeroPhases: [],
});
assert.ok(
  dTotal.zeroStepGate.verdict === 'downgrade' && dTotal.zeroStepGate.kind === 'total',
  '2b v1.5兜底保留：无嫌疑+total==0→downgrade total',
);

const dSuspectNoConfirm = evaluateFinalizeGate({
  hasPhaseSuspects: true, totalCopySteps: 0, totalDbSteps: 0,
  zeroPhaseBoth: [], perRunZeroPhases: [],
});
assert.ok(dSuspectNoConfirm.zeroStepGate.verdict === 'keep',
  '2c 互斥保真：有嫌疑但双源未确认→total兜底不可见（旧else语义）');

const dBoth = evaluateFinalizeGate({
  hasPhaseSuspects: true, totalCopySteps: 5, totalDbSteps: 5,
  zeroPhaseBoth: [2], perRunZeroPhases: [3],
});
assert.ok(
  dBoth.zeroStepGate.kind === 'zeroPhase' && dBoth.perRunGate?.kind === 'perRun'
  && eq(dBoth.perRunGate.phases, [3]),
  '2d per-run独立：双通道同时降级（不互斥）',
);

const dClean = evaluateFinalizeGate({
  hasPhaseSuspects: false, totalCopySteps: 7, totalDbSteps: 7,
  zeroPhaseBoth: [], perRunZeroPhases: [],
});
assert.ok(dClean.zeroStepGate.verdict === 'keep' && dClean.perRunGate === null, '2e 干净录制→不降级');

const dPerRunOnly = evaluateFinalizeGate({
  hasPhaseSuspects: false, totalCopySteps: 4, totalDbSteps: 4,
  zeroPhaseBoth: [], perRunZeroPhases: [2],
});
assert.ok(
  dPerRunOnly.zeroStepGate.verdict === 'keep' && dPerRunOnly.perRunGate?.kind === 'perRun',
  '2f v3兜底独立：重录掩蔽场景仅perRunGate降级',
);

// 3. collectFailedPhases + evaluateFinalVerdict：v3 同步终局
const okO = { success: true, text: 'a' };
const badO = { success: false, text: 'c' };
const dualKeyOutcomes = { 11: okO, 1: okO, 13: badO, 3: badO }; // phase.id/phaseNumber 双键同对象
const phases = [
  { id: 11, phaseNumber: 1 },
  { id: 13, phaseNumber: 2 },
  { id: 15, phaseNumber: 3 },
];
assert.ok(eq(collectFailedPhases(dualKeyOutcomes, phases), [2]),
  '3a 双键同对象：按 phase.id 判定、报 phaseNumber（P2-#6 不混 DB id）——id=13 失败报号 2');
assert.ok(eq(collectFailedPhases({ 11: { success: null }, 1: { success: true } }, phases), []),
  '3b 无显式失败→空清单（null/unknown 不阻塞）');

assert.ok(eq(evaluateFinalVerdict({ failedPhases: [1], qualityFails: [], trajSuccess: true }),
  { success: false, failKind: 'phase_failed' }), '3c 显式失败→phase_failed');
assert.ok(eq(evaluateFinalVerdict({ failedPhases: [1], qualityFails: [{ phase: 2, reasons: ['x'] }], trajSuccess: false }),
  { success: false, failKind: 'quality_failed' }), '3d QUALITY FAIL 优先取值');
assert.ok(evaluateFinalVerdict({ failedPhases: [], qualityFails: [], trajSuccess: false }).success === false,
  '3e 聚合false→failure');
assert.ok(eq(evaluateFinalVerdict({ failedPhases: [], qualityFails: [], trajSuccess: true }),
  { success: true, failKind: null }), '3f 全干净→success收官');

// 3g–3j + 纯函数直测：phase_blocked 区分（#909 移交项②，诚实受阻 vs 真质量缺陷，
// 三条件全满足才降级；任一不满足维持现行二分）
assert.ok(isBlockedOnlyFailure({ failedPhases: [2], qualityFails: [{ phase: 2, reasons: ['missing_success_token'] }] }),
  'isBlockedOnlyFailure: blocked-only 三条件全满足→true');
assert.ok(!isBlockedOnlyFailure({ failedPhases: [], qualityFails: [{ phase: 2, reasons: ['missing_success_token'] }] }),
  'isBlockedOnlyFailure: 条件1 不满足（failedPhases 空）→false');
assert.ok(!isBlockedOnlyFailure({ failedPhases: [2], qualityFails: [{ phase: 2, reasons: ['pending_fields:姓名'] }] }),
  'isBlockedOnlyFailure: 条件2 不满足（pending_fields 属真质量信号）→false');
assert.ok(!isBlockedOnlyFailure({ failedPhases: [2], qualityFails: [{ phase: 2, reasons: ['missing_success_token', 'semantic_doubt_fields:x'] }] }),
  'isBlockedOnlyFailure: 条件2 不满足（混入任一非 missing_success_token）→false');
assert.ok(!isBlockedOnlyFailure({ failedPhases: [1], qualityFails: [{ phase: 2, reasons: ['missing_success_token'] }] }),
  'isBlockedOnlyFailure: 条件3 不满足（标记附着于非失败阶段）→false');
assert.ok(!isBlockedOnlyFailure({ failedPhases: [2], qualityFails: [] }),
  'isBlockedOnlyFailure: qualityFails 空→false');

assert.ok(eq(evaluateFinalVerdict({ failedPhases: [2], qualityFails: [{ phase: 2, reasons: ['missing_success_token'] }], trajSuccess: false }),
  { success: false, failKind: 'phase_blocked' }),
  '3g blocked-only 形态（failed=[2]+missing_success_token@phase2）→phase_blocked');
assert.ok(eq(evaluateFinalVerdict({ failedPhases: [2], qualityFails: [{ phase: 2, reasons: ['pending_fields:姓名'] }], trajSuccess: false }),
  { success: false, failKind: 'quality_failed' }),
  '3h 真质量形态（pending_fields）→quality_failed 不降级');
assert.ok(eq(evaluateFinalVerdict({ failedPhases: [2], qualityFails: [{ phase: 2, reasons: ['missing_success_token', 'pending_fields:姓名'] }], trajSuccess: false }),
  { success: false, failKind: 'quality_failed' }),
  '3h 混合形态（missing_success_token+pending_fields）→quality_failed 不降级');
assert.ok(eq(evaluateFinalVerdict({ failedPhases: [], qualityFails: [{ phase: 2, reasons: ['missing_success_token'] }], trajSuccess: true }),
  { success: false, failKind: 'quality_failed' }),
  '3i #973 纯核验形态（failedPhases 空）→quality_failed 不降级');
assert.ok(eq(evaluateFinalVerdict({ failedPhases: [1], qualityFails: [{ phase: 2, reasons: ['missing_success_token'] }], trajSuccess: false }),
  { success: false, failKind: 'quality_failed' }),
  '3j 标记附着于非失败阶段→quality_failed 不降级');

// 4. runner 接线（收敛后：消费模块输出，不再内联判定）
assert.ok(runner.includes('const phaseOutcome = evaluatePhaseOutcome({ explicitSuccess, phaseStepCount, donePayload })'),
  'runner recordPhaseResult consumes evaluatePhaseOutcome');
assert.ok(runner.includes('evaluateFinalizeGate({') && runner.includes('hasPhaseSuspects'),
  'runner finalize gate delegates to evaluateFinalizeGate');
assert.ok(runner.includes('collectFailedPhases(runtime.phaseOutcomes, phases)'),
  'runner final verdict consumes collectFailedPhases');
assert.ok(runner.includes('const finalVerdict = evaluateFinalVerdict({ failedPhases: failedOutcomeKeys, qualityFails, trajSuccess })'),
  'runner final verdict consumes evaluateFinalVerdict');
assert.ok(!runner.includes('phase_blocked'),
  'runner does not inline phase_blocked (verdict stays in G3 gate module)');

console.log('characterize-phase-done-evidence-gate: OK (+Step1+blocked 34 assertions)');
