/**
 * Source B (el-table) display-name parity: agent JS_VERIFY_FORM_STRUCTURE and CTRL verifyFormStructure.
 *
 * Usage:
 *   node scripts/characterization/characterize-verify-form-structure.mjs
 *   node scripts/characterization/characterize-verify-form-structure.mjs --agent-only
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const agentOnly = process.argv.includes('--agent-only');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('OK:', msg);
  }
}

/** Mirror of verify matchTitle unnamed-sentinel rule (keep in sync with structure.js / misc.py). */
function matchTitle(el, want) {
  const w = String(want || '').trim();
  if (!el) return false;
  const aria = (el.getAttribute('aria-label') || '').trim();
  const header = (el.querySelector('.el-drawer__title, .el-drawer__header, .el-dialog__title')?.textContent || '').trim();
  if (!w || w === 'unnamed') return !aria && !header;
  return aria === w || header === w
    || (aria && (aria.includes(w) || w.includes(aria)))
    || (header && (header.includes(w) || w.includes(header)));
}

function mockOverlay({ aria = '', title = '' } = {}) {
  return {
    getAttribute: (k) => (k === 'aria-label' ? aria : null),
    querySelector: () => (title ? { textContent: title } : null),
  };
}

assert(matchTitle(mockOverlay({}), 'unnamed') === true, 'unnamed matches empty-title dialog');
assert(matchTitle(mockOverlay({ title: '选择客户' }), 'unnamed') === false, 'unnamed rejects titled dialog');
assert(matchTitle(mockOverlay({ title: '选择客户' }), '选择客户') === true, 'titled dialog still matches');
assert(matchTitle(mockOverlay({ aria: '客户查询' }), 'unnamed') === false, 'unnamed rejects aria-labeled drawer');

/** Mirror of overlay_title_from_container_id (keep in sync with structure.js / misc.py). */
function overlayTitleFromContainerId(id) {
  const s = String(id || '').trim();
  let rest = s;
  if (s.startsWith('dialog:')) rest = s.slice(7);
  else if (s.startsWith('drawer:')) rest = s.slice(7);
  else return s;
  const i = rest.indexOf('|');
  if (i >= 0) return rest.slice(i + 1).trim();
  return rest.trim();
}

assert(overlayTitleFromContainerId('dialog:新增|新增客户校验') === '新增客户校验', 'pipe title extract');
assert(overlayTitleFromContainerId('dialog:新增|unnamed') === 'unnamed', 'pipe unnamed extract');
assert(overlayTitleFromContainerId('dialog:选择客户') === '选择客户', 'legacy title extract');

const misc = readFileSync(path.join(root, 'scripts/controller/actions/js_snippets/misc.py'), 'utf-8');
assert(/JS_VERIFY_FORM_STRUCTURE/.test(misc), 'JS_VERIFY_FORM_STRUCTURE defined');
assert(
  /w === 'unnamed'/.test(misc) && /!aria && !header/.test(misc),
  'agent verify treats dialog:unnamed as empty-title sentinel',
);
assert(
  /VERIFY_SOURCE_B_EL_TABLE/.test(misc),
  'JS_VERIFY_FORM_STRUCTURE includes VERIFY_SOURCE_B_EL_TABLE marker',
);
assert(
  /row#/.test(misc) && (/SOURCE_B_EMPTY_LEADING/.test(misc) || /domRowIndex/.test(misc) || /getRowLeadingText/.test(misc)),
  'verify Source B uses row# / leading-text naming cues',
);
assert(
  /buildTableDisplayName/.test(misc) || (/colHeader/.test(misc) && /\|#/.test(misc)),
  'verify Source B multi-control display name cue',
);
assert(
  /overlayTitleFromContainerId|indexOf\('\|'\)|split\(.*,\s*1\)/.test(misc),
  'agent verify parses pipe',
);

if (!agentOnly) {
  const ctrl = readFileSync(path.join(root, 'src/ctrl-actions/structure.js'), 'utf-8');
  assert(
    /VERIFY_SOURCE_B_EL_TABLE/.test(ctrl),
    'CTRL verifyFormStructure includes VERIFY_SOURCE_B_EL_TABLE',
  );
  assert(
    /w === 'unnamed'/.test(ctrl) && /!aria && !header/.test(ctrl),
    'CTRL verify treats dialog:unnamed as empty-title sentinel',
  );
  assert(
    /overlayTitleFromContainerId|indexOf\('\|'\)/.test(ctrl),
    'CTRL verify parses pipe',
  );
} else {
  console.log('SKIP: CTRL asserts (--agent-only)');
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log(`\nAll verify-form-structure characterizations passed${agentOnly ? ' (agent-only)' : ''}.`);
