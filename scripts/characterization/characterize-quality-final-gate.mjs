/**
 * 假成功防线 v3 终局门闩 pin（offline，no DB/session）。
 * 教训来源：2026-09-07 #612/#614/19:55 —— QUALITY FAIL 与阶段显式 success=false
 * 曾无法阻止整轨 recorded/isSuccessful=1；batch 侧无视 recordStatus 回填 recorded。
 * Run: node scripts/characterization/characterize-quality-final-gate.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function testRunnerQualityCapture() {
  const runner = readFileSync(
    join(root, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');
  // phase_end.quality_failed 捕获（订阅回调）
  assert.ok(
    runner.includes("type === 'phase_end' && payload?.quality_failed === true"),
    'subscription captures phase_end.quality_failed',
  );
  // per-run 重置 + 终局消费三处标记
  const marks = runner.split('runtime.phaseQualityFails').length - 1;
  assert.ok(marks >= 3, `phaseQualityFails wired (init/capture/consume), got ${marks}`);
  // per-run 0 步自报成功阶段登记（recordPhaseResult 0 步降级分支内）
  assert.ok(
    runner.includes('runtime.perRunZeroSuccessPhases = runtime.perRunZeroSuccessPhases || []).push({'),
    'recordPhaseResult registers perRunZeroSuccessPhases',
  );
}

function testRunnerFinalGate() {
  const runner = readFileSync(
    join(root, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');
  // 终局判定必须消费 phaseOutcomes 显式 false + qualityFails
  assert.ok(
    runner.includes('outcome?.success === false'),
    'final gate consumes explicit phase failure outcomes',
  );
  assert.ok(
    runner.includes('failedOutcomeKeys.length || qualityFails.length'),
    'final gate degrades on explicit failure OR quality fail',
  );
  // 顺序 pin：降级判定必须在无条件 success 写之前（而非只靠 90s 异步兜底）
  const degradeIdx = runner.indexOf('finalized as failure: failedPhases=');
  const successIdx = runner.indexOf("finishTransientRecording(tid, 'success')");
  assert.ok(degradeIdx > -1, 'sync degrade branch exists');
  assert.ok(successIdx > -1, 'success finalize exists');
  assert.ok(degradeIdx < successIdx, 'sync degrade check precedes success finalize');
}

function testRunnerGateOwnershipGuard() {
  const runner = readFileSync(
    join(root, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');
  // 90s 门闩归属守卫：runId 变化（新一轮录制）必须整体跳过，防止旧门闩覆写新 run 基线
  assert.ok(runner.includes('const gateRunId = runtime.currentRunId'),
    'gate captures gateRunId');
  assert.ok(runner.includes('runtime.currentRunId !== gateRunId'),
    'gate skips when superseded by a newer run');
  // per-run 真源复核（重录场景）：phaseStepCounts 是本轮口径，不受旧 run 步骤掩护
  assert.ok(
    runner.includes('runtime.phaseStepCounts?.get(p.id)'),
    'async gate re-checks per-run phaseStepCounts for zero-step suspects',
  );
  assert.ok(
    runner.includes('perRunZeroPhases,'),
    'async gate broadcasts perRunZeroPhases on downgrade',
  );
}

function testBatchConvergesFailure() {
  const batch = readFileSync(
    join(root, 'src/services/trajectory/batch-record.js'), 'utf8');
  // batch 必须消费 record/start 的终局结果：failed 不回填 recorded（job 不假绿）
  assert.ok(
    batch.includes('const recordOutcome = await startTrajectoryRecording(tid)'),
    'batch consumes startTrajectoryRecording result',
  );
  assert.ok(
    batch.includes("recordOutcome?.recordStatus === 'failed'"),
    'batch checks recordStatus === failed',
  );
  assert.ok(
    batch.includes("'RECORD_QUALITY_GATE'"),
    'failed convergence goes through markItemFailed with gate error code',
  );
}

const steps = [
  testRunnerQualityCapture,
  testRunnerFinalGate,
  testRunnerGateOwnershipGuard,
  testBatchConvergesFailure,
];
let failed = 0;
for (const [i, fn] of steps.entries()) {
  try {
    fn();
    console.log(`step ${i + 1}/${steps.length} ${fn.name}: OK`);
  } catch (err) {
    failed += 1;
    console.error(`step ${i + 1}/${steps.length} ${fn.name}: FAIL — ${err.message}`);
  }
}
if (failed > 0) {
  console.error(`characterize-quality-final-gate: FAIL (${failed} steps)`);
  process.exit(1);
}
console.log(`characterize-quality-final-gate: OK ${steps.length}/${steps.length}`);
