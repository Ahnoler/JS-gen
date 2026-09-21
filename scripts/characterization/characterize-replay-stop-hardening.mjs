/**
 * Characterization: 停止回放加固系列 pin（stop-replay hardening series）。
 *
 * 本文件是 2026-09-21「停止回放系统线」缺陷修复系列（Task 1..6）的系列级
 * 固化点，后续任务在本文件追加各自断言（文件名保持不变）。
 *
 * Task 1/6 — Type B 表单结构自愈在用户停止后仍执行不可逆删步：
 * form-structure-heal.js 的 handleFormStructureCheckpoint 此前只在 AI 修复段
 * （runHealStep 内部）收敛 stop，扫描返回后与删除循环（removeById /
 * reorderByTrajectory）完全不读 runtime.abortReplay——用户 stop 后，过时扫描
 * 结果仍会永久删除已录 fill 步骤。本 pin 钉住三个新守卫的存在与位置：
 *
 *   G1  scan（runReplayActions）成功返回后、batchResults 解析前：
 *       runtime.abortReplay 置位 → user-abort 形状返回（makeUserAbortError）
 *   G2  删除循环内 removeById 之前：每轮复核 abort → break（绝不再删）
 *   G3  删除段结束后、插入段（addingLabels）之前：user-abort 返回，
 *       已删条目如实记入 deletedStepIds（不回滚，也不再进入插入/改快照段）
 *
 * 全部为 read_text needle + 源码切片断言（零 import 被测模块——该模块 import
 * 副作用面含 ws-server / executor-session-client，无 ESM mock 能力下不做行为
 * 驱动；锚定为「函数名 + 语义行」切片，任一守卫被移除或移位即红）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const FSH = readFileSync(join(ROOT, 'src/services/trajectory/form-structure-heal.js'), 'utf8');

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};
const count = (hay, needle) => hay.split(needle).length - 1;
const idx = (hay, needle, label) => {
  const i = hay.indexOf(needle);
  assert.ok(i >= 0, `源码未命中: ${label}`);
  return i;
};

// ── 切片定位：scan 段 catch 返回 → batchResults 解析（G1 所在区间） ───────────
const CATCH_RET = 'return { ok: false, aborted: true, error: msg, results, healed };';
const BATCH_PARSE = 'const batchResults = Array.isArray(result?.results) ? result.results : [];';
const catchRetIdx = idx(FSH, CATCH_RET, 'Type B scan catch 返回');
const batchIdx = idx(FSH, BATCH_PARSE, 'batchResults 解析行');
assert.ok(catchRetIdx < batchIdx, 'scan catch 返回应先于 batchResults 解析');
const SCAN_TAIL = FSH.slice(catchRetIdx, batchIdx);

// ── 切片定位：删除循环头 → removeById（G2 所在区间） ──────────────────────────
const LOOP_START = 'for (const r of candidates) {';
const REMOVE = 'await trajectoryStepDao.removeById(sid);';
const loopIdx = idx(FSH, LOOP_START, '删除循环头');
const removeIdx = idx(FSH, REMOVE, 'removeById 调用');
assert.ok(loopIdx < removeIdx, '删除循环头应先于 removeById');
const LOOP_HEAD = FSH.slice(loopIdx, removeIdx);

// ── 切片定位：reorderByTrajectory → addingLabels（G3 所在区间） ───────────────
const REORDER = 'await trajectoryStepDao.reorderByTrajectory(tid);';
const ADDING = 'const addingLabels = [';
const reorderIdx = idx(FSH, REORDER, 'reorderByTrajectory 调用');
const addingIdx = idx(FSH, ADDING, 'addingLabels 声明');
assert.ok(reorderIdx < addingIdx, 'reorderByTrajectory 应先于 addingLabels 段');
const DELETE_TAIL = FSH.slice(reorderIdx, addingIdx);

// ── 1. G1：scan 成功返回后的 user-abort 守卫（进 parse/safety/needsTypeB 之前） ─
record('1a G1 存在：catch 返回与 batchResults 解析之间复核 runtime.abortReplay',
  count(SCAN_TAIL, 'if (runtime.abortReplay)') === 1);
record('1b G1 返回 user-abort 形状：userAbort 标记 + makeUserAbortError（消费方 isUserAbort 可识别）',
  SCAN_TAIL.includes('userAbort: true') && SCAN_TAIL.includes('makeUserAbortError()'));
record('1c G1 不丢已产生结果：results/healed 原样带回',
  SCAN_TAIL.includes('results,') && /\bhealed,\s*\};/.test(SCAN_TAIL));

// ── 2. G2：删除循环内 removeById 之前的 break 守卫 ─────────────────────────────
record('2a G2 存在：removeById 之前每轮复核 runtime.abortReplay',
  count(LOOP_HEAD, 'if (runtime.abortReplay)') === 1);
record('2b G2 置位即 break（不再继续删）',
  count(LOOP_HEAD, 'break;') === 1);
record('2c G2 守卫先于 removeById（切片内序）',
  LOOP_HEAD.indexOf('if (runtime.abortReplay)') < LOOP_HEAD.indexOf('break;')
  && LOOP_HEAD.lastIndexOf('break;') < LOOP_HEAD.length - 1);
record('2d 全文件唯一删步点：removeById 仅出现一次（新增删点须同 commit 补守卫+补 pin）',
  count(FSH, REMOVE) === 1);
record('2e makeUserAbortError 已从 replay-heal-shared 导入（user-abort 构造单源）',
  FSH.includes('makeUserAbortError,') && FSH.includes("} from './replay-heal-shared.js';"));

// ── 3. G3：删除段结束后、插入段之前的 user-abort 返回 ──────────────────────────
record('3a G3 存在：reorder 与 addingLabels 之间复核 runtime.abortReplay',
  count(DELETE_TAIL, 'if (runtime.abortReplay)') === 1);
record('3b G3 已删条目如实入账：deletedStepIds 带回、不回滚',
  DELETE_TAIL.includes('deletedStepIds: deletedIds'));
record('3c G3 返回 user-abort 形状（对齐既有 :userAbort 收敛分支）',
  DELETE_TAIL.includes('userAbort: true') && DELETE_TAIL.includes('makeUserAbortError()'));
record('3d G3 先于插入段（addingLabels 之前拦截，不进入 runHealStep/改快照）',
  DELETE_TAIL.includes('if (runtime.abortReplay)'));

// ── 4. 系列级兜底：本文件 abort 读点数量只增不减（守卫被删即红） ────────────────
record('4a runtime.abortReplay 读点 ≥4（G1/G2/G3 + 既有 AI 修复段收敛）',
  count(FSH, 'runtime.abortReplay') >= 4,
  `count=${count(FSH, 'runtime.abortReplay')}`);

const bad = results.filter((r) => !r.ok);
console.log(`\ncharacterize-replay-stop-hardening: ${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
