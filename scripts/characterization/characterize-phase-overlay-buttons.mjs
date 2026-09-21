/**
 * Characterization: 阶段正常收口的「常态弹窗按钮清单」现状固化（离线，needle + 顺序断言）。
 *
 * 钉死 #917④b 挂账项实现后的数据流三步，任一环被改动即红，倒逼改者显式确认：
 *   ① Python 取数复用：phase_end 路径引用 recorder_emitters._probe_overlay_button_texts
 *      （语义最近一次 overlay.buttons 权威清单），并复用既有上限常量 _PROBE_BUTTONS_MAX
 *      （至多 8 个、单标签截 20 字在取数函数内）——不重复实现截断；
 *      probe 收口路径（record_probe_done_log）对同一取数的既有调用保持原样。
 *   ② 非空才置键（空 → 不置 = 零输出防噪红线）：service.py phase_end payload 仅在
 *      _overlay_buttons 非空时才设 phase_payload["overlayButtons"]，且位于 emit
 *      phase_end 之前、payload 组装（maxActionsPerStep）之后。
 *   ③ Node 落 doneLog：runner phase_end 分支对 payload.overlayButtons 判非空数组后
 *      appendPhaseDoneLog(session?.activePhaseId, { text: 'overlay buttons: ' + …
 *      .map((b) => `[${b}]`).join(''), source: 'agent' }).catch(() => {})——文本形态
 *      对齐 probe 收口 [a][b] 拼法；recordPhaseResult 既有 3 处 appendPhaseDoneLog
 *      调用不动（总数恰 4）。
 *
 * Run: node scripts/characterization/characterize-phase-overlay-buttons.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SERVICE = readFileSync(join(ROOT, 'scripts/agent/service.py'), 'utf8');
const EMITTERS = readFileSync(join(ROOT, 'scripts/agent/recorder_emitters.py'), 'utf8');
const RUNNER = readFileSync(join(ROOT, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};
const count = (hay, needle) => hay.split(needle).length - 1;
// find 用不抛错的 indexOf（RED 阶段 needle 未实现时输出 FAIL 行而非崩溃）。
const find = (hay, needle, from = 0) => hay.indexOf(needle, from);

// ── ① Python 取数复用（不重复实现截断） ─────────────────────────────────────
record('1a recorder_emitters 定义 _probe_overlay_button_texts（恰 1 处，既有行为不变）',
  count(EMITTERS, 'def _probe_overlay_button_texts() -> list[str]:') === 1);
record('1b probe 收口对同一取数的既有调用保留（_btns = …[:_PROBE_BUTTONS_MAX] 恰 1 处）',
  count(EMITTERS, '_btns = _probe_overlay_button_texts()[:_PROBE_BUTTONS_MAX]') === 1);
record('1c service.py 函数级导入既有取数与上限常量（恰 1 处，无重新实现）',
  count(SERVICE, 'from .recorder_emitters import _PROBE_BUTTONS_MAX, _probe_overlay_button_texts') === 1);
record('1d service.py phase_end 路径调用取数并沿用既有上限（恰 1 处）',
  count(SERVICE, '_overlay_buttons = _probe_overlay_button_texts()[:_PROBE_BUTTONS_MAX]') === 1);

// ── ② 非空才置键（空 → 不置，零输出防噪） ───────────────────────────────────
const OVERLAY_SET = 'phase_payload["overlayButtons"] = _overlay_buttons';
const guardIdx = find(SERVICE, 'if _overlay_buttons:');
const setIdx = find(SERVICE, OVERLAY_SET);
record('2a overlayButtons 置键恰 1 处且由 if _overlay_buttons: 守卫（守卫先于置键）',
  count(SERVICE, OVERLAY_SET) === 1 && guardIdx >= 0 && guardIdx < setIdx);
const maxActsIdx = find(SERVICE, 'phase_payload["maxActionsPerStep"]');
const emitPhaseEndIdx = find(SERVICE, 'emit_json({"event": "phase_end"');
record('2b 置键位于 payload 组装（maxActionsPerStep）之后、emit phase_end 之前',
  maxActsIdx >= 0 && setIdx > maxActsIdx && emitPhaseEndIdx > setIdx,
  `maxActs=${maxActsIdx} set=${setIdx} emit=${emitPhaseEndIdx}`);

// ── ③ Node phase_end 分支落 doneLog ─────────────────────────────────────────
// 窗口限定 phase_end 分支（quality_failed 捕获块 → pushPhaseObservation），
// 与 recordPhaseResult / fail 路径的既有 appendPhaseDoneLog 调用区分开。
const winStart = find(RUNNER, "if (type === 'phase_end' && payload?.quality_failed === true) {");
const winEnd = find(RUNNER, 'pushPhaseObservation(type, payload);');
const WIN = winStart >= 0 && winEnd > winStart ? RUNNER.slice(winStart, winEnd) : '';
record('3a phase_end 分支窗口存在（quality_failed 捕获块 → pushPhaseObservation）',
  winStart >= 0 && winEnd > winStart);
record('3b 窗口内对 overlayButtons 判非空数组（空 → 不落，防噪红线）',
  count(WIN, 'Array.isArray(payload?.overlayButtons)') === 1
  && count(WIN, 'payload.overlayButtons.length > 0') === 1);
record('3c 窗口内 appendPhaseDoneLog 落 session.activePhaseId（恰 1 处，与 runner 其他调用同源）',
  count(WIN, 'appendPhaseDoneLog(session?.activePhaseId, {') === 1);
record('3d 文本前缀 overlay buttons: 与 [a][b] 拼法（对齐 probe 收口形态）',
  count(WIN, "'overlay buttons: '") === 1
  && count(WIN, '.map((b) => `[${b}]`).join(\'\')') === 1);
record('3e source: agent 且 .catch(() => {}); 调用包裹防噪声（needle 带分号，不匹配注释字样）',
  count(WIN, "source: 'agent',") === 1 && count(WIN, '.catch(() => {});') === 1);
record('3f 判空先于落库（条件表达式行为等价：空清单不调用）',
  (() => {
    const cond = find(WIN, 'Array.isArray(payload?.overlayButtons)');
    const call = find(WIN, 'appendPhaseDoneLog(');
    return cond >= 0 && call > cond;
  })());
record('3g runner appendPhaseDoneLog 调用总数恰 4（recordPhaseResult 2 + fail 1 + 新增 1）',
  count(RUNNER, 'appendPhaseDoneLog(') === 4, `count=${count(RUNNER, 'appendPhaseDoneLog(')}`);

const bad = results.filter((r) => !r.ok);
console.log(`\ncharacterize-phase-overlay-buttons: ${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
