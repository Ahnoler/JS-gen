/**
 * Characterization: B-2 traj-recon reconciliation logging pins (offline, read_text style).
 *
 * Pins the `[traj-recon]` stepCount-vs-row-count reconciliation logging batch
 * (spec docs/superpowers/specs/2026-09-18-engine-pipeline-b123-fix-design.md §二 —
 * logging only, zero behavior change). Four hook points:
 *   - hook 1 (runner handleActionLogSync): coalesce removedIds → dbIds mapping;
 *     `unmapped=[...]` non-empty = A2 signal (mapping gap → silent missed delete)
 *   - hook 2 (persist-service removeRecordedStepsByDbIds): requested/deleted/mismatch;
 *     mismatch>0 = where-in not hitting all requested rows
 *   - hook 3 (runner recordPhaseResult, after refreshTrajectoryCounts):
 *     rawRows/bizRows/copyBiz/maxStep/gaps; rawRows−bizRows = meta rows (A1),
 *     gaps non-empty = step_number sequence breaks (B1)
 *   - hook 4 (runner async gate finalize): existing `copy=db` log extended to
 *     `[traj-recon] finalize traj=... rawRows=... biz=... copy=... maxStep=...`
 * Hook 5 (stop 收口) is intentionally NOT part of this batch — pinned absent via
 * occurrence counts + zero recon logs in the stop/lifecycle module.
 *
 * All recon readings are single-line key=value logs: every needle below is asserted
 * within ONE source line (no cross-line string concatenation matching).
 *
 * Run:
 *   node scripts/characterization/characterize-traj-recon-logging.mjs
 */
import { readFileSync } from 'fs';

const RUNNER_PATH = 'src/services/trajectory/trajectory-recording-runner.js';
const PERSIST_PATH = 'src/services/trajectory/trajectory-persist-service.js';
const LIFECYCLE_PATH = 'src/services/trajectory/trajectory-record-lifecycle.js';

const runnerSrc = readFileSync(new URL(`../../${RUNNER_PATH}`, import.meta.url), 'utf8');
const persistSrc = readFileSync(new URL(`../../${PERSIST_PATH}`, import.meta.url), 'utf8');
const lifecycleSrc = readFileSync(new URL(`../../${LIFECYCLE_PATH}`, import.meta.url), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Return source lines that contain ALL needles (single-line match, no cross-line join). */
function findLines(src, needles) {
  return src.split(/\r?\n/).filter((line) => needles.every((n) => line.includes(n)));
}

/** Assert exactly one source line contains all needles and it closes on a single line. */
function assertSingleLineLog(srcPath, src, statement, label) {
  const hits = findLines(src, [statement]);
  assert(hits.length === 1, `${srcPath}: ${label} — expected exactly 1 single-line match, got ${hits.length}`);
  assert(
    hits[0].trim().endsWith('`);'),
    `${srcPath}: ${label} — log statement must be closed on the same single line`,
  );
}

const COALESCE_LOG =
  "console.log(`[traj-recon] coalesce traj=${tid} removed=${removedIds.length} mapped=${dbIds.length} unmapped=[${unmappedAids.join(',')}]`);";
const REMOVE_LOG =
  "console.log(`[traj-recon] remove traj=${tid} requested=${ids.length} deleted=${deleted} mismatch=${ids.length - deleted}`);";
const PHASE_LOG =
  "console.log(`[traj-recon] phase traj=${tid} rawRows=${reconRows.length} bizRows=${counts.stepCount} copyBiz=${copyBiz} maxStep=${reconMaxStep} gaps=[${gaps.join(',')}]`);";
const FINALIZE_LOG =
  "console.log(`[traj-recon] finalize traj=${tid} rawRows=${reconRawRows} biz=${dbSteps} copy=${copySteps} maxStep=${reconMaxStep}`);";

function lineIndexOf(src, needle, fromLine = 0) {
  const lines = src.split(/\r?\n/);
  for (let i = fromLine; i < lines.length; i++) {
    if (lines[i].includes(needle)) return i;
  }
  return -1;
}

function testHook1Coalesce() {
  assertSingleLineLog(RUNNER_PATH, runnerSrc, COALESCE_LOG, 'coalesce recon log');
  // unmapped 收集逻辑必须在场：dbId 映射失败的 actionId 进入 unmapped（A2 实锤信号源）
  const collect = findLines(runnerSrc, ['else unmappedAids.push(aid);']);
  assert(collect.length === 1, `${RUNNER_PATH}: expected exactly 1 'else unmappedAids.push(aid);' in dbId mapping, got ${collect.length}`);
  assert(
    findLines(runnerSrc, ['const unmappedAids = [];']).length === 1,
    `${RUNNER_PATH}: unmappedAids collector must be declared alongside dbIds`,
  );
  // 挂点必须在 `if (dbIds.length)` 之前 —— 全 unmapped（mapped=0）时日志仍要打出
  const logIdx = runnerSrc.split(/\r?\n/).findIndex((l) => l.includes('[traj-recon] coalesce traj='));
  const gateIdx = lineIndexOfFirst(runnerSrc, 'if (dbIds.length) {');
  assert(gateIdx > logIdx && logIdx >= 0, `${RUNNER_PATH}: coalesce log must be emitted BEFORE the if (dbIds.length) gate (got log=${logIdx}, gate=${gateIdx})`);
}

function lineIndexOfFirst(src, needle) {
  return src.split(/\r?\n/).findIndex((l) => l.includes(needle));
}

function testHook2Remove() {
  assertSingleLineLog(PERSIST_PATH, persistSrc, REMOVE_LOG, 'remove recon log');
  // 必须落在 removeRecordedStepsByDbIds 的删除执行（.del()）之后
  const fnIdx = lineIndexOfFirst(persistSrc, 'export async function removeRecordedStepsByDbIds');
  const delIdx = lineIndexOfFirst(persistSrc.slice(lineOffsetOf(persistSrc, fnIdx)), '.del()');
  const logIdx = lineIndexOfFirst(persistSrc.slice(lineOffsetOf(persistSrc, fnIdx)), '[traj-recon] remove traj=');
  assert(fnIdx >= 0, `${PERSIST_PATH}: removeRecordedStepsByDbIds not found`);
  assert(delIdx >= 0 && logIdx > delIdx, `${PERSIST_PATH}: remove recon log must come AFTER the .del() execution (got del=${delIdx}, log=${logIdx})`);
}

function lineOffsetOf(src, lineIndex) {
  if (lineIndex < 0) return 0;
  const lines = src.split(/\r?\n/);
  return lines.slice(0, lineIndex).reduce((acc, l) => acc + l.length + 1, 0);
}

function testHook3Phase() {
  assertSingleLineLog(RUNNER_PATH, runnerSrc, PHASE_LOG, 'phase recon log');
  // gaps 断号检测逻辑在场
  assert(
    findLines(runnerSrc, ['const gaps = [];']).length === 1,
    `${RUNNER_PATH}: gaps collector must be declared in the phase recon block`,
  );
  // 位置：recordPhaseResult 内、refreshTrajectoryCounts 之后、阶段收尾（capturePhaseScreenshot）之前
  const firstRefresh = lineIndexOfFirst(runnerSrc, 'await refreshTrajectoryCounts(tid)');
  const screenshotIdx = lineIndexOfFirst(runnerSrc, 'await capturePhaseScreenshot({');
  const logIdx = lineIndexOfFirst(runnerSrc, '[traj-recon] phase traj=');
  assert(firstRefresh >= 0 && screenshotIdx >= 0, `${RUNNER_PATH}: recordPhaseResult anchors not found`);
  assert(
    logIdx > firstRefresh && logIdx < screenshotIdx,
    `${RUNNER_PATH}: phase recon log must sit inside recordPhaseResult after refreshTrajectoryCounts (got log=${logIdx}, refresh=${firstRefresh}, screenshot=${screenshotIdx})`,
  );
}

function testHook4Finalize() {
  // 旧 copy=db 日志已被扩字段替换（不允许新旧并存）
  assert(
    !runnerSrc.includes('[record] async gate finalize'),
    `${RUNNER_PATH}: old '[record] async gate finalize' log must be extended into '[traj-recon] finalize'`,
  );
  assertSingleLineLog(RUNNER_PATH, runnerSrc, FINALIZE_LOG, 'finalize recon log');
  // 位置：async gate 的 counts 刷新之后，且 rawRows/maxStep 由一次 listByTrajectory 查询支撑
  const lines = runnerSrc.split(/\r?\n/);
  const refreshIdxs = lines
    .map((l, i) => (l.includes('await refreshTrajectoryCounts(tid)') ? i : -1))
    .filter((i) => i >= 0);
  assert(refreshIdxs.length === 2, `${RUNNER_PATH}: expected exactly 2 refreshTrajectoryCounts(tid) call sites, got ${refreshIdxs.length}`);
  const finalizeIdx = lines.findIndex((l) => l.includes('[traj-recon] finalize traj='));
  assert(finalizeIdx > refreshIdxs[1], `${RUNNER_PATH}: finalize recon log must come after the async-gate counts refresh (got log=${finalizeIdx}, refresh=${refreshIdxs[1]})`);
  const listIdx = lines.findIndex((l, i) => i > refreshIdxs[1] && l.includes('listByTrajectory(tid)'));
  assert(listIdx >= 0 && listIdx < finalizeIdx, `${RUNNER_PATH}: finalize rawRows/maxStep must be backed by a listByTrajectory query before the log (got list=${listIdx}, log=${finalizeIdx})`);
}

function testSingleLineKvFormat() {
  for (const [path, src, stmt, label] of [
    [RUNNER_PATH, runnerSrc, COALESCE_LOG, 'coalesce'],
    [PERSIST_PATH, persistSrc, REMOVE_LOG, 'remove'],
    [RUNNER_PATH, runnerSrc, PHASE_LOG, 'phase'],
    [RUNNER_PATH, runnerSrc, FINALIZE_LOG, 'finalize'],
  ]) {
    assertSingleLineLog(path, src, stmt, label);
  }
}

function testOccurrenceCountsNoScopeCreep() {
  // 计数对象=console 日志语句（模板字面量以 [traj-recon] 开头），注释文本不计数
  const countStmt = (src) => (src.match(/console\.(?:log|warn)\(`\[traj-recon\]/g) || []).length;
  // runner: coalesce log + phase log + phase recon-failure warn + finalize log = 4；多一个少一个都算越界
  assert(countStmt(runnerSrc) === 4, `${RUNNER_PATH}: expected exactly 4 '[traj-recon]' console statements (3 hooks + 1 recon-failure warn), got ${countStmt(runnerSrc)}`);
  assert(countStmt(persistSrc) === 1, `${PERSIST_PATH}: expected exactly 1 '[traj-recon]' console statement (remove hook), got ${countStmt(persistSrc)}`);
  // 挂点 5（stop 收口）明确不做：stop/lifecycle 模块不得出现 recon 日志
  assert((lifecycleSrc.match(/\[traj-recon\]/g) || []).length === 0, `${LIFECYCLE_PATH}: stop path must carry NO '[traj-recon]' logs (hook 5 out of scope this batch)`);
}

async function main() {
  console.log('\n=== Trajectory recon logging characterization ===\n');
  const tests = [
    ['hook1 coalesce unmapped', testHook1Coalesce],
    ['hook2 remove mismatch', testHook2Remove],
    ['hook3 phase rawRows/gaps', testHook3Phase],
    ['hook4 finalize extended', testHook4Finalize],
    ['single-line kv format', testSingleLineKvFormat],
    ['occurrence counts (no hook5)', testOccurrenceCountsNoScopeCreep],
  ];
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.log(`  ✗ ${name} — ${err.message}`);
    }
  }
  console.log(failed ? `\nFAILED (${failed})\n` : '\nOK\n');
  process.exit(failed ? 1 : 0);
}

main();
