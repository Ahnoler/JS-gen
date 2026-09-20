import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertBusinessTaskText } from '../../../tools/recording-coach/src/task-text.mjs';
import { assertDispatchBrief } from '../../../tools/recording-coach/src/dispatch-brief.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const skill = path.join(root, 'tools/recording-coach/skill');
for (const rel of [
  'references/pipeline-pits.md',
  'references/acceptance.md',
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

assertDispatchBrief(fs.readFileSync(path.join(skill, 'templates/dispatch-brief.md'), 'utf8'));
assert.equal(
  assertBusinessTaskText('【硬性成功门闩——未满足不得 done】\n' + 'y'.repeat(80)),
  true,
);

for (const script of ['init-evidence.mjs', 'scaffold-brief.mjs', 'preflight-probes.mjs']) {
  const r = spawnSync(process.execPath, [path.join(skill, 'scripts', script), '--help'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, script + ' --help');
}

console.log('OK recording-coach-skill-pack');
