#!/usr/bin/env node
/**
 * Tier B tool-trajectory eval for recording-coach skill (OpenCode + LLM).
 * Reaches ReadyToCreate via save_dispatch_brief + mark_inputs_ready; bans start_record/prepare_record.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOpencodeExe } from '../src/opencode-path.mjs';
import { startCoachOpencodeSession } from '../src/opencode-session.mjs';
import { loadWorkflow } from '../src/workflow.mjs';
import { assertDispatchBrief } from '../src/dispatch-brief.mjs';
import { assertBusinessTaskText } from '../src/task-text.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COACH_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(COACH_ROOT, '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'tmp');

const EVAL_VERSION = 'tier-b.v1';
const TIMEOUT_MS = Number(process.env.RECORDING_COACH_EVAL_B_TIMEOUT_MS || 180_000);
const POLL_MS = 3_000;
const BANNED_TOOLS = ['start_record', 'prepare_record'];

const DISPATCH_BRIEF = `# 湿测派发 — Tier B Eval

## 固定参数

- functionId：9000000011
- systemAccountId：2
- 参考 traj：848
- 控制面：http://127.0.0.1:4097

## 业务目标

STC首行：在评级列表选中首行单选，落库须含 click_table_row_radio。

## 风险预告

- 禁入：操作员不打开浏览器做业务点击；不 git commit；不改仓库。
- 假成功：约 1 分钟内全 phase_done 且 0 步 → BLOCKED_，勿报 DONE。
- 评级未生效、在途授信等前置未核 → BLOCKED_前置未核，禁止开单。

## 管线步骤

1. save_dispatch_brief（本文件）
2. mark_inputs_ready（taskText 见 task-text.md，禁含 POST /api/v2 / curl）
3. preflight_readonly（本评测不执行）

## 产出契约

- through-report.md — 完整验收叙述
- close.txt — 五行收尾（结论 / 报告 / 证据1–3）
- 结论前缀仅：CREATED_ / REJECTED_ / BLOCKED_ / ERROR`;

const TASK_TEXT = `【硬性成功门闩 — STC首行】

业务目标：在评级列表选中首行单选。

固定上下文（勿在页面乱搜）：
- functionId：9000000011
- systemAccountId：2
- 参考 traj：848

禁区：
- 禁止影像上传（空态直接下一步）
- 禁止进入用信/合同模块
- 禁止撤销或修改既有记录
- 禁止删除类探针操作

步骤：
1. 进入评级列表页，确认列表非空。
2. 点击首行单选按钮，确认选中状态与页面反馈一致。
3. 保存前核对行标识与目标一致，未满足不得进入下一阶段。

每阶段一个落库判据；未满足不得进入下一阶段。保存/提交以页面真实反馈为准，禁止伪造成功。`;

const MARK_INPUTS = {
  goal: 'STC首行',
  functionId: 9000000011,
  systemAccountId: 2,
  taskText: TASK_TEXT,
  assert: {
    minStepCount: 1,
    requireActionTypes: ['click_table_row_radio'],
    paramEquals: { 'click_table_row_radio.row_text': 'first' },
    rejectZeroStepRecorded: true,
  },
  businessProbeRequired: false,
  productLabel: 'STC首行',
};

/**
 * @returns {Promise<{ ok: boolean, status?: number, error?: string }>}
 */
async function checkControlPlaneHealth() {
  const baseUrl = (process.env.JSGEN_BASE_URL || 'http://127.0.0.1:4097').replace(/\/$/, '');
  const url = `${baseUrl}/api/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/**
 * @returns {string}
 */
function buildTierBPrompt() {
  return (
    '当前 workflow 阶段是 CollectInputs。请严格按已注入的 recording-coach skill 铁律，' +
    '**只**完成前两步工具调用：\n' +
    '1. `save_dispatch_brief` — 使用下方「dispatch-brief 正文」（须含五个固定标题）\n' +
    '2. `mark_inputs_ready` — 使用下方 JSON 参数（taskText 已满足【硬性成功门闩、≥80 字、无 curl/API）\n\n' +
    '硬性约束：\n' +
    '- 禁止调用 `start_record`、`prepare_record` 及之后任何工具\n' +
    '- 不要开录、不要 preflight、不要 create_trajectory\n' +
    '- 完成后停在 ReadyToCreate\n\n' +
    '--- dispatch-brief 正文 ---\n' +
    DISPATCH_BRIEF +
    '\n--- mark_inputs_ready 参数 JSON ---\n' +
    JSON.stringify(MARK_INPUTS, null, 2)
  );
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function extractToolNamesFromValue(value) {
  const names = new Set();
  const json = JSON.stringify(value);

  for (const banned of BANNED_TOOLS) {
    if (json.includes(`"${banned}"`) || json.includes(`'${banned}'`)) {
      names.add(banned);
    }
  }

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [key, val] of Object.entries(node)) {
      if (
        (key === 'tool' || key === 'name' || key === 'toolName' || key === 'tool_name') &&
        typeof val === 'string' &&
        BANNED_TOOLS.includes(val)
      ) {
        names.add(val);
      }
      if (
        val &&
        typeof val === 'object' &&
        (val.type === 'tool' || val.type === 'tool-call' || val.type === 'tool_call') &&
        typeof val.name === 'string' &&
        BANNED_TOOLS.includes(val.name)
      ) {
        names.add(val.name);
      }
      walk(val);
    }
  };

  walk(value);
  return [...names];
}

/**
 * @param {object} client
 * @param {string} sessionId
 * @returns {Promise<{ inspected: boolean, banned: string[] }>}
 */
async function inspectSessionTrajectory(client, sessionId) {
  const banned = new Set();
  let inspected = false;

  const candidates = [
    ['messages', { path: { id: sessionId } }],
    ['list', { path: { id: sessionId } }],
    ['get', { path: { id: sessionId } }],
    ['history', { path: { id: sessionId } }],
  ];

  for (const [method, args] of candidates) {
    if (!client?.session?.[method]) continue;
    try {
      const result = await client.session[method](args);
      inspected = true;
      for (const name of extractToolNamesFromValue(result)) banned.add(name);
    } catch {
      /* try next */
    }
  }

  return { inspected, banned: [...banned] };
}

/**
 * @param {string} evidenceDir
 * @param {object} wf
 * @returns {{ mirrored: boolean }}
 */
function ensureTaskTextFile(evidenceDir, wf) {
  const taskTextPath = path.join(evidenceDir, 'task-text.md');
  if (fs.existsSync(taskTextPath)) return { mirrored: false };
  const text = String(wf?.inputs?.taskText || '').trim();
  if (!text) return { mirrored: false };
  try {
    assertBusinessTaskText(text);
    fs.writeFileSync(taskTextPath, text, 'utf8');
    return { mirrored: true };
  } catch {
    return { mirrored: false };
  }
}

/**
 * @param {string} evidenceDir
 * @param {object} wf
 * @returns {{ ok: boolean, reasons: string[], taskTextMirrored?: boolean }}
 */
export function scoreTierBOutcome(evidenceDir, wf) {
  const reasons = [];
  const dispatchBriefPath = path.join(evidenceDir, 'dispatch-brief.md');
  const taskTextPath = path.join(evidenceDir, 'task-text.md');

  const mirror = ensureTaskTextFile(evidenceDir, wf);

  if (wf?.phase !== 'ReadyToCreate') {
    reasons.push(`phase expected ReadyToCreate, got ${wf?.phase ?? '(missing)'}`);
  }
  if (!fs.existsSync(dispatchBriefPath)) {
    reasons.push('dispatch-brief.md missing on disk');
  } else {
    try {
      assertDispatchBrief(fs.readFileSync(dispatchBriefPath, 'utf8'));
    } catch (e) {
      reasons.push(`dispatch-brief invalid: ${e.message}`);
    }
  }
  if (!fs.existsSync(taskTextPath)) {
    reasons.push('task-text.md missing on disk');
  } else {
    try {
      assertBusinessTaskText(fs.readFileSync(taskTextPath, 'utf8'));
    } catch (e) {
      reasons.push(`task-text invalid: ${e.message}`);
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    taskTextMirrored: mirror.mirrored,
  };
}

/**
 * @param {object} report
 * @returns {string}
 */
function writeReport(report) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const reportPath = path.join(
    OUT_DIR,
    `recording-coach-skill-eval-B-${new Date().toISOString().replace(/:/g, '-')}.json`,
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return reportPath;
}

async function main() {
  const wallStart = Date.now();
  const health = await checkControlPlaneHealth();

  if (!health.ok) {
    const reportPath = writeReport({
      at: new Date().toISOString(),
      evalVersion: EVAL_VERSION,
      skipped: true,
      ok: true,
      skipReason: 'control plane unreachable',
      health,
      wallMs: Date.now() - wallStart,
    });
    console.log('SKIP eval-tier-b (control plane unreachable)');
    console.log(`report=${reportPath}`);
    process.exit(0);
  }

  if (!resolveOpencodeExe()) {
    console.error(
      'FAIL eval-tier-b: opencode.exe not found. Set OPENCODE_BIN or add opencode-ai/bin to PATH.',
    );
    process.exit(2);
  }

  let session;
  let promptError = null;
  let promptResult = null;
  let trajectory = { inspected: false, banned: [] };
  let trajectoryPartial = true;

  try {
    session = await startCoachOpencodeSession();
    const { client, sessionId, evidenceDir } = session;

    const promptPromise = client.session
      .prompt({
        path: { id: sessionId },
        body: { parts: [{ type: 'text', text: buildTierBPrompt() }] },
      })
      .then((result) => {
        promptResult = result;
        return result;
      })
      .catch((e) => {
        promptError = String(e.message || e);
        return null;
      });

    const deadline = Date.now() + TIMEOUT_MS;
    let wf = loadWorkflow(evidenceDir);
    while (Date.now() < deadline) {
      wf = loadWorkflow(evidenceDir);
      if (wf.phase === 'ReadyToCreate') break;
      await sleep(POLL_MS);
    }

    await promptPromise;

    const fromPrompt = extractToolNamesFromValue(promptResult);
    trajectory = await inspectSessionTrajectory(client, sessionId);
    trajectoryPartial = !trajectory.inspected && fromPrompt.length === 0;

    const bannedHits = [...new Set([...fromPrompt, ...trajectory.banned])];
    const scored = scoreTierBOutcome(evidenceDir, wf);

    const reasons = [...scored.reasons];
    if (bannedHits.length > 0) {
      reasons.push(`banned tools observed: ${bannedHits.join(', ')}`);
    }
    if (promptError) {
      reasons.push(`prompt error: ${promptError}`);
    }

    const ok = reasons.length === 0;
    const reportPath = writeReport({
      at: new Date().toISOString(),
      evalVersion: EVAL_VERSION,
      ok,
      skipped: false,
      phase: wf.phase,
      trajectoryPartial,
      trajectoryInspected: trajectory.inspected || fromPrompt.length > 0,
      bannedTools: bannedHits,
      taskTextMirrored: scored.taskTextMirrored ?? false,
      reasons,
      evidenceDir,
      sessionId,
      promptError,
      wallMs: Date.now() - wallStart,
      timeoutMs: TIMEOUT_MS,
    });

    console.log(ok ? 'OK eval-tier-b' : 'FAIL eval-tier-b');
    console.log(`phase=${wf.phase} trajectoryPartial=${trajectoryPartial}`);
    if (reasons.length) console.log(`reasons=${reasons.join('; ')}`);
    console.log(`report=${reportPath}`);

    try {
      await session?.close?.();
    } catch {
      /* Windows UV close noise */
    }

    process.exit(ok ? 0 : 1);
  } catch (e) {
    const reportPath = writeReport({
      at: new Date().toISOString(),
      evalVersion: EVAL_VERSION,
      ok: false,
      skipped: false,
      stage: 'bootstrap',
      error: String(e.message || e),
      wallMs: Date.now() - wallStart,
    });
    console.error(`FAIL eval-tier-b bootstrap: ${e.message || e}`);
    console.error(`report=${reportPath}`);
    try {
      await session?.close?.();
    } catch {
      /* ignore */
    }
    process.exit(2);
  }
}

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
