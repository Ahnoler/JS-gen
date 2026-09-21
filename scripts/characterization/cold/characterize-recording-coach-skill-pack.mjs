import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertBusinessTaskText } from '../../../tools/recording-coach/src/task-text.mjs';
import { assertDispatchBrief } from '../../../tools/recording-coach/src/dispatch-brief.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const skill = path.join(root, 'tools/recording-coach/skill');
const scriptsDir = path.join(skill, 'scripts');

/**
 * @param {string} script
 * @param {string[]} args
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
function runScript(script, args) {
  return spawnSync(process.execPath, [path.join(scriptsDir, script), ...args], {
    encoding: 'utf8',
    cwd: root,
  });
}

// --- Layer inventory ---
for (const rel of [
  'SKILL.md',
  'references/pipeline-pits.md',
  'references/acceptance.md',
  'references/phase-granularity.md',
  'references/operator-ops.md',
  'references/stc-anchors.md',
  'templates/dispatch-brief.md',
  'templates/task-text.md',
  'templates/close.txt',
  'templates/evidence-checklist.md',
  'scripts/init-evidence.mjs',
  'scripts/scaffold-brief.mjs',
  'scripts/preflight-probes.mjs',
]) {
  assert.ok(fs.existsSync(path.join(skill, rel)), rel);
}

const skillMd = fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8');
assert.match(skillMd, /只读核查员/);
assert.match(skillMd, /取证员/);
assert.match(skillMd, /templates\/task-text\.md/);

const briefTpl = fs.readFileSync(path.join(skill, 'templates/dispatch-brief.md'), 'utf8');
assertDispatchBrief(briefTpl);

const taskTpl = fs.readFileSync(path.join(skill, 'templates/task-text.md'), 'utf8');
assert.match(taskTpl, /【硬性成功门闩/);
assert.match(taskTpl, /\{\{TASK_BODY\}\}/);

const closeTpl = fs.readFileSync(path.join(skill, 'templates/close.txt'), 'utf8');
for (const prefix of ['结论：', '报告：', '证据1：', '证据2：', '证据3：']) {
  assert.ok(closeTpl.includes(prefix), `close.txt missing ${prefix}`);
}

const acceptance = fs.readFileSync(path.join(skill, 'references/acceptance.md'), 'utf8');
assert.match(acceptance, /索引点击可能归一为/);
assert.match(acceptance, /click_table_row_radio/);

const phaseGranularity = fs.readFileSync(
  path.join(skill, 'references/phase-granularity.md'),
  'utf8',
);
assert.match(phaseGranularity, /一个可验证的状态变更/);
assert.match(phaseGranularity, /确认弹窗并入触发它的动作/);
assert.match(phaseGranularity, /展开\/更多 = 状态边界/);
assert.match(phaseGranularity, /禁止沉淀为铁律/);
assert.match(phaseGranularity, /skillWorthy=no-workaround/);
assert.match(skillMd, /phase-granularity\.md/);
assert.match(skillMd, /operator-ops\.md/);

const operatorOps = fs.readFileSync(path.join(skill, 'references/operator-ops.md'), 'utf8');
assert.match(operatorOps, /执行操作员/);
assert.match(operatorOps, /BLOCKED_NOT-ADJUDICATED_/);
assert.match(operatorOps, /最多再试 \*\*1\*\* 次/);
assert.match(operatorOps, /禁删除类探针/);
assert.match(operatorOps, /勿再写入任务模板/);
assert.match(operatorOps, /复制守卫/);

assert.equal(
  assertBusinessTaskText('【硬性成功门闩——未满足不得 done】\n' + 'y'.repeat(80)),
  true,
);
assert.throws(() => assertBusinessTaskText('STC首行'), /taskText must be the business gate/);
assert.throws(
  () => assertBusinessTaskText('【硬性成功门闩】\n' + 'y'.repeat(80) + '\ncurl http://x'),
  /taskText must be the business gate/,
);
assert.throws(
  () =>
    assertBusinessTaskText(
      '【硬性成功门闩】\n' + 'y'.repeat(80) + '\nPOST /api/v2/trajectories',
    ),
  /taskText must be the business gate/,
);

for (const script of ['init-evidence.mjs', 'scaffold-brief.mjs', 'preflight-probes.mjs']) {
  const r = runScript(script, ['--help']);
  assert.equal(r.status, 0, `${script} --help → ${r.status}\n${r.stderr}`);
}

// --- Dry-runs (no HTTP / no --apply / no --run) ---
const pinTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-skill-pack-'));
let evidenceDir = '';

try {
  const init = runScript('init-evidence.mjs', [
    '--repo',
    root,
    '--label',
    'skill-pack-pin',
  ]);
  assert.equal(init.status, 0, `init-evidence failed: ${init.stderr}`);
  const m = /evidenceDir=(.+)\r?\n?/.exec(init.stdout);
  assert.ok(m, `init stdout missing evidenceDir=: ${init.stdout}`);
  evidenceDir = m[1].trim();
  assert.ok(fs.existsSync(path.join(evidenceDir, 'workflow.json')), 'workflow.json');
  assert.ok(
    fs.existsSync(path.join(evidenceDir, 'evidence-checklist.md')),
    'evidence-checklist.md',
  );
  assert.equal(
    fs.readFileSync(path.join(evidenceDir, 'hypothesis.txt'), 'utf8').trim(),
    'skill-pack-pin',
  );

  const taskBodyPath = path.join(pinTmp, 'task-body.txt');
  const taskBody =
    '落库验收：查询客户后选首行；提交以页面真实反馈为准；服务端拒绝照抄提示与流水号。';
  fs.writeFileSync(taskBodyPath, taskBody, 'utf8');

  const scaffold = runScript('scaffold-brief.mjs', [
    '--evidence',
    evidenceDir,
    '--goal',
    'STC首行湿测冷验收',
    '--function-id',
    '9000000011',
    '--account-id',
    '1',
    '--ref-traj',
    '908',
    '--task-file',
    taskBodyPath,
    '--product-label',
    'skill-pack-pin',
  ]);
  assert.equal(scaffold.status, 0, `scaffold-brief failed: ${scaffold.stderr}\n${scaffold.stdout}`);
  const jsonLine = scaffold.stdout
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.startsWith('{'));
  assert.ok(jsonLine, `scaffold stdout missing JSON: ${scaffold.stdout}`);
  const payload = JSON.parse(jsonLine);
  assert.equal(payload.ok, true);
  assert.equal(payload.evidenceDir, evidenceDir);
  assert.ok(payload.dispatchBriefPath);
  assert.ok(payload.taskTextPath);

  const writtenBrief = fs.readFileSync(payload.dispatchBriefPath, 'utf8');
  assertDispatchBrief(writtenBrief);
  assert.match(writtenBrief, /STC首行湿测冷验收/);
  assert.match(writtenBrief, /9000000011/);

  const writtenTask = fs.readFileSync(payload.taskTextPath, 'utf8');
  assert.equal(assertBusinessTaskText(writtenTask), true);
  assert.ok(writtenTask.includes(taskBody));

  const preflight = runScript('preflight-probes.mjs', [
    '--evidence',
    evidenceDir,
    '--profile',
    'none',
  ]);
  assert.equal(preflight.status, 0, `preflight none failed: ${preflight.stderr}`);
  const probes = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'probes.json'), 'utf8'));
  assert.deepEqual(probes, []);

  const needCustom = runScript('preflight-probes.mjs', [
    '--evidence',
    evidenceDir,
    '--profile',
    'rating-credit',
  ]);
  assert.equal(needCustom.status, 2, 'rating-credit without --custom-json must exit 2');
  assert.match(String(needCustom.stderr), /api\/docs/);
} finally {
  if (evidenceDir && fs.existsSync(evidenceDir)) {
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  }
  fs.rmSync(pinTmp, { recursive: true, force: true });
}

console.log('OK recording-coach-skill-pack');
