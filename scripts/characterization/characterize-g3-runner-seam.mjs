/**
 * Characterization: G3 控制面接缝。驱动 trajectory-recording-runner.js 里
 * 集成 PR #45 时改写的那两处表达式（整轨聚合 + per-run 零步过滤），
 * 表达式从合并后源码逐字抽取后 eval——源码改了测试跟着变，不会镜像漂移。
 *
 * 表达式不是另抄一份，而是从合并后源码里逐字抽取后 eval——源码改了测试就跟着变，
 * 不会出现"镜像漂移"式的假绿。
 *
 * 覆盖：整轨聚合（含 phaseOutcomes 双键同对象的真实形状）、per-run 零步过滤，
 * 特别是**迟到步不误杀**（本轮计数已 >0 的阶段不得被降级）——这正是我方刻意
 * 不采纳 PR 同步 DB 计数判定的理由。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyZeroStepFakeSuccessGate, aggregateTrajectorySuccessful } from '../../src/services/trajectory/phase-done-evidence-gate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const RUNNER = readFileSync(join(ROOT, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');

/** 从源码逐字抽取一段并编译为可调用表达式。 */
function extract(re, label) {
  const m = RUNNER.match(re);
  assert.ok(m, `源码未命中: ${label}`);
  return { src: m[0], fn: new Function('runtime', 'aggregateTrajectorySuccessful', 'applyZeroStepFakeSuccessGate', `${m[0]}\nreturn this.__out;`) };
}

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};

// ── 1. 整轨聚合：抽取真实赋值语句 ────────────────────────────────────────────
const AGG_RE = /const trajSuccess = aggregateTrajectorySuccessful\(runtime\.phaseOutcomes\);/;
assert.ok(AGG_RE.test(RUNNER), '未找到 trajSuccess 聚合语句（接线被改？）');
const AGG = RUNNER.match(AGG_RE)[0];
const agg = (runtime) => new Function('runtime', 'aggregateTrajectorySuccessful', `${AGG}\nreturn trajSuccess;`)(runtime, aggregateTrajectorySuccessful);

// 真实形状：phaseOutcomes 以 phase.id / phaseNumber 双键同写同一对象
const outcomeOk = { success: true, text: 'a' };
const outcomeNull = { success: null, text: 'b' };
const outcomeBad = { success: false, text: 'c' };

record('1a 全成功/未知 → 整轨成功（null 不阻塞）',
  agg({ phaseOutcomes: { 11: outcomeOk, 1: outcomeOk, 12: outcomeNull, 2: outcomeNull } }) === true);
record('1b 任一显式 false → 整轨失败（双键同对象也成立）',
  agg({ phaseOutcomes: { 11: outcomeOk, 1: outcomeOk, 13: outcomeBad, 3: outcomeBad } }) === false);
record('1c 空/缺失 phaseOutcomes 不误判为失败',
  agg({}) === true && agg({ phaseOutcomes: null }) === true);

// ── 2. per-run 零步过滤：抽取真实 filter 块 ─────────────────────────────────
const PR_START = 'const perRunZeroPhases = (runtime.perRunZeroSuccessPhases || [])';
const PR_END = '.map((p) => p.phaseNumber);';
const prStart = RUNNER.indexOf(PR_START);
const prEnd = prStart >= 0 ? RUNNER.indexOf(PR_END, prStart) : -1;
assert.ok(prStart >= 0 && prEnd > prStart, '未找到 perRunZeroPhases 过滤块（接线被改？）');
const PR_SRC = RUNNER.slice(prStart, prEnd + PR_END.length).replace(/^ {6}/gm, '');
console.log('--- 抽取到的过滤块 ---\n' + PR_SRC + '\n----------------------');
// 真实形状：per-run 计数 Map 以 **DB 阶段 id（数字）** 为键——写入侧 set(phaseIdHint/
// trajectoryPhaseId)、读取侧 get(phase.id)/get(p.id)，同键空间。若哪天写入/读取键
// 类型或来源分叉，计数会恒读 0 → 异步门闩把所有阶段误判成 0 步并降级整轨。
assert.match(RUNNER, /runtime\.phaseStepCounts\.set\(countPhaseId/, '写入侧以 countPhaseId 为键');
assert.match(RUNNER, /const countPhaseId = Number\.isFinite\(persisted\.trajectoryPhaseId\)/, '写入侧首选 DB 解析的 trajectoryPhaseId');
assert.match(RUNNER, /id: phase\.id,/, '嫌疑清单以 phase.id 记录（与计数键同空间）');
record('0 键空间契约：计数写入/读取/嫌疑清单都用 DB 阶段 id（数字）',
  /runtime\.phaseStepCounts\.get\(phase\.id\)/.test(RUNNER)
  && /stepCount: runtime\.phaseStepCounts\?\.get\(p\.id\) \|\| 0/.test(RUNNER));

const perRun = (runtime) => new Function('runtime', 'applyZeroStepFakeSuccessGate',
  `${PR_SRC}\nreturn perRunZeroPhases;`)(runtime, applyZeroStepFakeSuccessGate);

const mkRuntime = (suspects) => ({
  perRunZeroSuccessPhases: suspects,
  // 与真实运行时同形：数字键 Map
  phaseStepCounts: new Map(suspects.map((s) => [s.id, s.__count])),
});

// 本轮 0 步（伪）vs 本轮已落步（迟到步 / 真录制）
const r2 = mkRuntime([{ id: 41, phaseNumber: 2, __count: 0 }, { id: 42, phaseNumber: 3, __count: 3 }]);
record('2a 只标记本轮计数仍为 0 的嫌疑阶段', JSON.stringify(perRun(r2)) === '[2]',
  `got ${JSON.stringify(perRun(r2))}`);

const rLate = mkRuntime([{ id: 41, phaseNumber: 2, __count: 0 }, { id: 42, phaseNumber: 3, __count: 1 }]);
record('2b 迟到步不误杀：本轮已有 1 步的阶段被排除',
  JSON.stringify(perRun(rLate)) === '[2]', `got ${JSON.stringify(perRun(rLate))}`);

record('2c 无嫌疑阶段 → 空（不降级整轨）',
  perRun(mkRuntime([])) .length === 0);

// 2d 意图对照：**累积** DB 口径下同一场景会被误杀——我们不用它，用 per-run
const cumulativeDbCount = 99; // 旧 run 落的步（重录场景累积口径被掩护）
const perRunCount = 0;
const gatedNow = applyZeroStepFakeSuccessGate({ stepCount: perRunCount, donePayload: { success: true } });
const gatedCumulative = applyZeroStepFakeSuccessGate({ stepCount: cumulativeDbCount, donePayload: { success: true } });
record('2d 口径对照：per-run 0 步判拒、累积 99 步判不拒（故不能拿累积口径做同步判定）',
  gatedNow.rejectedZeroStep === true && gatedCumulative.rejectedZeroStep === false,
  `perRun=${gatedNow.rejectedZeroStep} cumulative=${gatedCumulative.rejectedZeroStep}`);

record('2e rejectedZeroStep 语义：0 步+自报成功→拒；有步→不拒；诚实失败→不拒',
  applyZeroStepFakeSuccessGate({ stepCount: 0, donePayload: { success: true } }).rejectedZeroStep === true
  && applyZeroStepFakeSuccessGate({ stepCount: 2, donePayload: { success: true } }).rejectedZeroStep === false
  && applyZeroStepFakeSuccessGate({ stepCount: 0, donePayload: { success: false } }).rejectedZeroStep === false);

const bad = results.filter((r) => !r.ok);
console.log(`\ncharacterize-g3-runner-seam: ${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
