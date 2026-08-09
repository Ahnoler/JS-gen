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

const misc = readFileSync(path.join(root, 'scripts/controller/actions/js_snippets/misc.py'), 'utf-8');
assert(/JS_VERIFY_FORM_STRUCTURE/.test(misc), 'JS_VERIFY_FORM_STRUCTURE defined');
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

if (!agentOnly) {
  const ctrl = readFileSync(path.join(root, 'src/ctrl-actions/structure.js'), 'utf-8');
  assert(
    /VERIFY_SOURCE_B_EL_TABLE/.test(ctrl),
    'CTRL verifyFormStructure includes VERIFY_SOURCE_B_EL_TABLE',
  );
} else {
  console.log('SKIP: CTRL asserts (--agent-only)');
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log(`\nAll verify-form-structure characterizations passed${agentOnly ? ' (agent-only)' : ''}.`);
