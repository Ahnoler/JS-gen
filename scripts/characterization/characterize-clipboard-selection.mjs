import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CLIPBOARD_GET_SELECTION_EXPRESSION,
  normalizeClipboardSelectionResult,
} from '../../src/cdp/clipboard-selection.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bib = readFileSync(path.join(root, 'executor/bib-bridge.js'), 'utf8');
const agent = readFileSync(path.join(root, 'executor/agent.mjs'), 'utf8');
assert.match(bib, /kind\s*===\s*['"]clipboard['"]|kind === \"clipboard\"/);
assert.match(bib, /getSelection/);
assert.match(bib, /reason:\s*['"]not_attached['"]/);
assert.match(agent, /session\.bib_clipboard/);
assert.match(agent, /session\.bib_input/);

const execWs = readFileSync(path.join(root, 'src/executor-ws.js'), 'utf8');
assert.match(execWs, /session\.bib_clipboard/);
assert.match(execWs, /remote:clipboard/);
const cdpInput = readFileSync(path.join(root, 'src/cdp/remote-bridge/cdp-input.js'), 'utf8');
assert.match(cdpInput, /clipboard/);
const router = readFileSync(path.join(root, 'src/cdp/remote-bridge/ws-router.js'), 'utf8');
assert.match(router, /remote:clipboard/);

assert.equal(typeof CLIPBOARD_GET_SELECTION_EXPRESSION, 'string');
assert.match(CLIPBOARD_GET_SELECTION_EXPRESSION, /selectionStart/);
assert.match(CLIPBOARD_GET_SELECTION_EXPRESSION, /getSelection/);
assert.match(CLIPBOARD_GET_SELECTION_EXPRESSION, /INPUT|TEXTAREA/);

assert.deepEqual(normalizeClipboardSelectionResult({ ok: true, text: 'ab' }), {
  ok: true,
  text: 'ab',
});
assert.deepEqual(normalizeClipboardSelectionResult({ ok: true, text: '' }), {
  ok: true,
  text: '',
});
assert.equal(normalizeClipboardSelectionResult(null).ok, false);
assert.equal(normalizeClipboardSelectionResult({ ok: false, reason: 'evaluate_error' }).reason, 'evaluate_error');

// Expression must be runnable as function body returning { ok, text }
const fn = new Function(`return (${CLIPBOARD_GET_SELECTION_EXPRESSION})`);
// jsdom-less: only check it parses; runtime shape tested via normalize + string cues
assert.equal(typeof fn, 'function');

console.log('characterize-clipboard-selection: OK');
