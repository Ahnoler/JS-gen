/**
 * Lightweight smoke: screenshot kind parsing + assembler before/after emission.
 * Does not require MySQL.
 */
import { spawnSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findScreenshotForStep, findScreenshotsForStep } from '../../src/runtime/script-runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const pair = findScreenshotsForStep(3, [
  { fileName: 'step-3-before-r1.png', url: '/b', stepNumber: 3, kind: 'before' },
  { fileName: 'step-3-after-r1.png', url: '/a', stepNumber: 3, kind: 'after' },
]);
assert(pair.before?.kind === 'before', 'before shot missing');
assert(pair.after?.kind === 'after', 'after shot missing');
assert(findScreenshotForStep(3, [pair.before, pair.after], 'before')?.fileName.includes('before'), 'kind filter');

const actionFile = path.join(__dirname, '..', 'action', `_characterize_ss_${Date.now()}.json`);
writeFileSync(actionFile, JSON.stringify({
  url: 'http://example.com',
  actions: [
    { action: 'click_menu_item', params: { menu_text: '首页' }, id: '501' },
  ],
}), 'utf8');

const py = spawnSync('python', [path.join(__dirname, '..', 'script_assembler.py'), actionFile], {
  encoding: 'utf-8',
  cwd: path.join(__dirname, '..', '..'),
});
if (existsSync(actionFile)) unlinkSync(actionFile);
assert(py.status === 0, `assembler failed: ${py.stderr || py.stdout}`);
const script = py.stdout || '';
assert(script.includes('step-1-before-'), 'assembler missing before screenshot');
assert(script.includes('step-1-after-'), 'assembler missing after screenshot');
assert(script.includes('__REPLAY_STEP__'), 'assembler missing replay marker');

console.log('ok: characterize screenshots before/after');
