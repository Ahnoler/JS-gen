#!/usr/bin/env node
/**
 * Characterize: 零步 navigate 豁免（A/B 移交 ②，733/741/742 登录回放代导航误杀）。
 *
 * 登录回放代导航（业务阶段本身零动作、自报成功）是合法形态，被 v3 零步假成功门
 * 整轨降级为 failed（733/741/742）。修法=豁免参数化、登记面前置：
 * - `isNavigateOnlyPhase`（runner 导出纯函数，判定数据源首选 phase 行 v1 合约
 *   mode，无合约退 description 写动词表）：navigate/other+无写动词→true；
 *   写动词（保存/删除…）→false；mode=create/modify→false；无合约无描述→false（保守）。
 * - `evaluatePhaseOutcome` 新可选参数 `phaseIsNavigateOnly`（默认 false=现行为
 *   逐字不变）：navigate-only+零步+自报成功 → success 保持 true、无 [0步完成]
 *   前缀、registerPerRun=false；非 navigate 零步仍降级（既有
 *   characterize-phase-done-evidence-gate.mjs 34 断言不许漂，本 pin 1x 复钉）。
 * - runner 接线 needle：recordPhaseResult 计算豁免 + 带 flag 复判 + v3 perRun
 *   登记 / v2 phaseBusinessCounts 嫌疑 / [0步完成] 门日志三处消费点均被覆盖。
 *
 * RED 纪律：实现前 isNavigateOnlyPhase 导出缺失 + flag 行为断言必红。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluatePhaseOutcome } from '../../../src/services/trajectory/phase-done-evidence-gate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..', '..');

// 动态 import：实现前 runner 尚无该导出（named import 会 link 期整体报错，
// 吞掉后逐断言留 RED 证据）。
let isNavigateOnlyPhase;
try {
  ({ isNavigateOnlyPhase } = await import(
    '../../../src/services/trajectory/trajectory-recording-runner.js'
  ));
} catch (err) {
  console.log('NOTE: runner import failed (expected pre-implementation):', err.message);
}

const validContract = (mode) => ({
  v: 1,
  mode,
  refill: 'none',
  submitRequired: false,
  successWhen: [],
  source: 'analyze',
});

// ── 1. isNavigateOnlyPhase 行为（保守：拿不准一律 false）─────────────────────
assert.equal(typeof isNavigateOnlyPhase, 'function',
  'runner exports isNavigateOnlyPhase(phase)');

assert.equal(isNavigateOnlyPhase({
  contractJson: validContract('navigate'),
  description: '打开评级页面并点击发起评级',
}), true, 'contract mode=navigate + 无写动词描述 → true');

assert.equal(isNavigateOnlyPhase({
  contractJson: validContract('other'),
  description: '进入风险分类统计页',
}), true, 'contract mode=other + 无写动词描述 → true');

assert.equal(isNavigateOnlyPhase({
  contractJson: validContract('navigate'),
  description: '打开页面并保存后返回',
}), false, 'navigate 但描述含「保存」→ false');

assert.equal(isNavigateOnlyPhase({
  contractJson: validContract('other'),
  description: '确认后删除残留记录',
}), false, 'other 但描述含「删除」→ false');

assert.equal(isNavigateOnlyPhase({
  contractJson: validContract('create'),
  description: '打开新增页面',
}), false, 'mode=create → false（即使描述无写动词）');

assert.equal(isNavigateOnlyPhase({
  contractJson: validContract('modify'),
  description: '进入修改页',
}), false, 'mode=modify → false');

assert.equal(isNavigateOnlyPhase({ description: '', contractJson: null }), false,
  '无合约无描述 → false（保守）');

assert.equal(isNavigateOnlyPhase({ description: '打开客户查询页面' }), true,
  '无合约 + 描述无写动词 → true');

assert.equal(isNavigateOnlyPhase({ description: '填写申请表单并提交' }), false,
  '无合约 + 描述含「填写/提交」→ false');

assert.equal(isNavigateOnlyPhase({}), false, '空 phase 行 → false（保守）');

assert.equal(isNavigateOnlyPhase({
  contractJson: validContract('query'),
  description: '查询客户列表',
}), false, 'mode=query 有合约 → false（豁免面仅限 navigate/other）');

// ── 2. evaluatePhaseOutcome 新参数行为 ──────────────────────────────────────
const ex = evaluatePhaseOutcome({
  explicitSuccess: true,
  phaseStepCount: 0,
  donePayload: { text: '已进入评级页' },
  phaseIsNavigateOnly: true,
});
assert.equal(ex.success, true, 'navigate-only+零步+自报成功 → success 保持 true');
assert.equal(ex.registerPerRun, false, 'navigate-only+零步+自报成功 → 不登记 perRun 嫌疑');
assert.equal(ex.text, '已进入评级页', 'navigate-only+零步+自报成功 → 无 [0步完成] 前缀');
assert.equal(ex.zeroStepPhase, true, 'navigate-only+零步 → zeroStepPhase 事实保留');

// 非 navigate 零步：现行为逐字不变（与既有 pin 1a 同形复钉，防漂）。
const legacy = evaluatePhaseOutcome({
  explicitSuccess: true,
  phaseStepCount: 0,
  donePayload: { text: '全部填完' },
});
assert.equal(legacy.success, null, '非 navigate 零步自报成功 → 仍降级 null');
assert.equal(legacy.text, '[0步完成] 全部填完', '非 navigate 零步 → 仍加 [0步完成] 前缀');
assert.equal(legacy.registerPerRun, true, '非 navigate 零步 → 仍登记 perRun 嫌疑');

const flaggedWithSteps = evaluatePhaseOutcome({
  explicitSuccess: true,
  phaseStepCount: 3,
  donePayload: { text: 'ok' },
  phaseIsNavigateOnly: true,
});
assert.equal(flaggedWithSteps.success, true, '有步自报成功（flag 无关）→ 原样通过');
assert.equal(flaggedWithSteps.text, 'ok', '有步 → 无 [0步完成] 前缀');
assert.equal(flaggedWithSteps.registerPerRun, false, '有步 → 不登记嫌疑');

const flaggedHonestFail = evaluatePhaseOutcome({
  explicitSuccess: false,
  phaseStepCount: 0,
  donePayload: { text: 'blocked' },
  phaseIsNavigateOnly: true,
});
assert.equal(flaggedHonestFail.success, false, 'navigate-only 零步诚实失败 → success=false 不豁免');
assert.equal(flaggedHonestFail.registerPerRun, false, '诚实失败 → 不登记嫌疑');

// ── 3. runner 接线 needle（豁免传参 + 三处消费点覆盖）───────────────────────
const runner = readFileSync(
  join(ROOT, 'src/services/trajectory/trajectory-recording-runner.js'),
  'utf8',
);
assert.ok(runner.includes('export function isNavigateOnlyPhase(phase)'),
  'runner defines exported isNavigateOnlyPhase(phase)');
assert.ok(
  runner.includes('const navigateExempt = phaseOutcome.registerPerRun && isNavigateOnlyPhase(phase)'),
  'recordPhaseResult computes navigateExempt (only where a suspect would be registered)',
);
assert.ok(runner.includes('phaseIsNavigateOnly: true'),
  'runner passes the exemption flag to evaluatePhaseOutcome');
assert.ok(runner.includes('if (phaseOutcomeFinal.registerPerRun)'),
  'v3 perRun 登记点消费豁免后结果（navigate-only 不登记）');
assert.ok(runner.includes('if (explicitSuccess === true && !navigateExempt)'),
  'v2 phaseBusinessCounts 嫌疑登记点被豁免覆盖');
assert.ok(runner.includes('if (zeroStepPhase && !navigateExempt)'),
  '[0步完成] 门日志点被豁免覆盖');

console.log('characterize-navigate-zero-step-exemption: OK (30 assertions)');
