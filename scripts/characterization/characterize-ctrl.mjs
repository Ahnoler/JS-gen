/**
 * Characterization: src/ctrl-actions.js is the canonical CTRL.* surface
 * (replay / assemble inject via getInjectionCode → window.CTRL).
 *
 * Agent-side JS lives in scripts/actions/_js_snippets.py and inline
 * page.evaluate in scripts/actions/*.py — intentionally not byte-identical.
 * This script asserts name-level parity so drift is caught loudly.
 *
 * Run:
 *   node scripts/characterization/characterize-ctrl.mjs
 *
 * ---------------------------------------------------------------------------
 * Mapping: CTRL method → cue(s) that must appear in Python (or assembler)
 *
 * Cue may be a JS_* constant name, an async def / action name, or a
 * distinctive string. Search roots: _js_snippets.py, actions/*.py,
 * and (assembler-only methods) script_assembler.py / models/form_snapshot.py.
 *
 *   getContainer          → JS_GET_CONTAINER
 *   fillFormField         → JS_FILL_FORM_FIELD
 *   selectOption          → JS_SELECT_OPTION
 *   selectDate            → JS_FILL_DATE_FIELD  (agent date path; CTRL.selectDate for replay)
 *   clickRadio            → JS_CLICK_RADIO
 *   selectTreeOption      → JS_SELECT_TREE_OPTION
 *   waitForLoading        → JS_WAIT_LOADING  (+ wait_for_loading in _misc.py)
 *   clickMenuItem         → click_menu_item       (_navigation.py)
 *   switchTab             → switch_tab            (_navigation.py)
 *   clickTableRowButton   → click_table_row_button (_table.py)
 *   clickTableRowRadio    → click_table_row_radio  (_table.py)
 *   closeDialog           → close_dialog          (_misc.py)
 *   checkFieldValue       → check_field_value     (_form.py)
 *   clickAdjacentButton   → click_adjacent_button (_form.py)
 *   clickIconButton       → click_icon_button / JS_CLICK_ICON_BUTTON (_misc.py / _js_snippets.py)
 *   expandAllTreeNodes    → expand_all_el_tree    (_form.py)
 *   fillAddressFields     → CTRL.fillAddressFields (script_assembler.py; agent uses fillFormField + address rules)
 *   verifyFormStructure   → verifyFormStructure   (form_snapshot.py / script_assembler.py; replay-only)
 * ---------------------------------------------------------------------------
 */
import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  CTRL_API_TABLE,
  CTRL_OBJECT,
  getInjectionCode,
} from '../../src/ctrl-actions.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');

/** @type {Record<string, { cues: string[], roots?: 'agent' | 'assembler' | 'both' }>} */
const CTRL_PYTHON_MAP = {
  getContainer: { cues: ['JS_GET_CONTAINER'], roots: 'agent' },
  isFormItemDisabled: { cues: ['JS_FIELD_DISABLED'], roots: 'agent' },
  fillFormField: { cues: ['JS_FILL_FORM_FIELD'], roots: 'agent' },
  selectOption: { cues: ['JS_SELECT_OPTION'], roots: 'agent' },
  selectDate: { cues: ['JS_FILL_DATE_FIELD'], roots: 'agent' },
  clickRadio: { cues: ['JS_CLICK_RADIO'], roots: 'agent' },
  selectTreeOption: { cues: ['JS_SELECT_TREE_OPTION'], roots: 'agent' },
  waitForLoading: { cues: ['JS_WAIT_LOADING', 'wait_for_loading'], roots: 'agent' },
  clickMenuItem: { cues: ['click_menu_item'], roots: 'agent' },
  switchTab: { cues: ['switch_tab'], roots: 'agent' },
  clickTableRowButton: { cues: ['click_table_row_button'], roots: 'agent' },
  clickTableRowRadio: { cues: ['click_table_row_radio'], roots: 'agent' },
  closeDialog: { cues: ['close_dialog'], roots: 'agent' },
  checkFieldValue: { cues: ['check_field_value'], roots: 'agent' },
  clickAdjacentButton: { cues: ['click_adjacent_button'], roots: 'agent' },
  clickIconButton: { cues: ['click_icon_button', 'JS_CLICK_ICON_BUTTON'], roots: 'agent' },
  expandAllTreeNodes: { cues: ['expand_all_el_tree'], roots: 'agent' },
  fillAddressFields: { cues: ['CTRL.fillAddressFields'], roots: 'assembler' },
  verifyFormStructure: { cues: ['verifyFormStructure'], roots: 'assembler' },
};

/** Helpers documented in API table (exclude from required CTRL.* rows). */
const API_TABLE_SKIP = new Set(['getContainer', 'verifyFormStructure']);

function parseCtrlMethods(ctrlObjectSrc) {
  const names = [];
  const re = /(?:^|\n)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(?:async\s*)?\(/g;
  let m;
  while ((m = re.exec(ctrlObjectSrc)) !== null) {
    names.push(m[1]);
  }
  return [...new Set(names)];
}

function loadAgentCorpus() {
  const snippets = readFileSync(join(here, '..', 'actions', '_js_snippets.py'), 'utf8');
  const actionsDir = join(here, '..', 'actions');
  const actionFiles = readdirSync(actionsDir)
    .filter((f) => f.endsWith('.py'))
    .map((f) => readFileSync(join(actionsDir, f), 'utf8'));
  return [snippets, ...actionFiles].join('\n');
}

function loadAssemblerCorpus() {
  const parts = [
    readFileSync(join(here, '..', 'script_assembler.py'), 'utf8'),
    readFileSync(join(here, '..', 'models', 'form_snapshot.py'), 'utf8'),
  ];
  return parts.join('\n');
}

function testParseMatchesMap() {
  const methods = parseCtrlMethods(CTRL_OBJECT);
  assert(methods.length >= 10, `expected many CTRL methods, got ${methods.length}`);

  const missingFromMap = methods.filter((n) => !(n in CTRL_PYTHON_MAP));
  assert(
    missingFromMap.length === 0,
    `CTRL_OBJECT has methods not in CTRL_PYTHON_MAP (update map or remove method): ${missingFromMap.join(', ')}`,
  );

  const staleInMap = Object.keys(CTRL_PYTHON_MAP).filter((n) => !methods.includes(n));
  assert(
    staleInMap.length === 0,
    `CTRL_PYTHON_MAP lists methods missing from CTRL_OBJECT: ${staleInMap.join(', ')}`,
  );

  return methods;
}

function testApiTableDocumentsMethods(methods) {
  for (const name of methods) {
    if (API_TABLE_SKIP.has(name)) continue;
    assert(
      CTRL_API_TABLE.includes(`CTRL.${name}`),
      `CTRL_API_TABLE missing CTRL.${name}`,
    );
  }
  assert(
    CTRL_API_TABLE.includes("result.startsWith('ok')"),
    'CTRL_API_TABLE should document ok* success convention',
  );
}

function testInjectionCode() {
  const code = getInjectionCode(2);
  assert(code.includes('window.CTRL'), 'injection must assign window.CTRL');
  assert(code.includes('fillFormField'), 'injection must include fillFormField');
  assert(code.includes('getContainer'), 'injection must include getContainer');
  assert(code.includes('el-dialog'), 'getContainer should prefer el-dialog');
  assert(code.includes('el-drawer'), 'getContainer should prefer el-drawer');
  assert(code.includes('page.evaluate'), 'injection wrapped in page.evaluate');
}

function testPythonParityCues(methods) {
  const agentCorpus = loadAgentCorpus();
  const assemblerCorpus = loadAssemblerCorpus();
  const both = `${agentCorpus}\n${assemblerCorpus}`;

  assert(agentCorpus.includes('JS_GET_CONTAINER'), 'Python must define JS_GET_CONTAINER');
  assert(agentCorpus.includes('.el-dialog'), 'Python container must know el-dialog');
  assert(agentCorpus.includes('.el-drawer'), 'Python container must know el-drawer');
  assert(
    CTRL_OBJECT.includes('HTMLInputElement') || CTRL_OBJECT.includes('setAttribute'),
    'CTRL fill path should use native setter / attribute pattern',
  );
  assert(
    agentCorpus.includes('HTMLInputElement') || agentCorpus.includes('native'),
    'Python fill snippet should reference native setter pattern',
  );

  const failures = [];
  for (const name of methods) {
    const entry = CTRL_PYTHON_MAP[name];
    const corpus =
      entry.roots === 'assembler'
        ? assemblerCorpus
        : entry.roots === 'both'
          ? both
          : agentCorpus;
    const found = entry.cues.some((cue) => corpus.includes(cue));
    if (!found) {
      failures.push(
        `${name}: none of [${entry.cues.join(', ')}] found in ${entry.roots || 'agent'} corpus`,
      );
    }
  }
  assert(failures.length === 0, `CTRL↔Python parity failures:\n  - ${failures.join('\n  - ')}`);
}

function testAssemblerLoadsCtrl() {
  const assembler = readFileSync(join(here, '..', 'script_assembler.py'), 'utf8');
  assert(
    assembler.includes('ctrl-actions.js') || assembler.includes('getInjectionCode'),
    'script_assembler should load CTRL from ctrl-actions.js',
  );
}

function testCanonicalHeader() {
  const src = readFileSync(join(ROOT, 'src/ctrl-actions.js'), 'utf8');
  assert(
    /canonical|唯一来源|单[一⼀]来源/i.test(src),
    'ctrl-actions.js should declare itself as the canonical CTRL source',
  );
}

const methods = testParseMatchesMap();
testApiTableDocumentsMethods(methods);
testInjectionCode();
testPythonParityCues(methods);
testAssemblerLoadsCtrl();
testCanonicalHeader();
console.log(
  `ok: characterization CTRL (${methods.length} methods; ctrl-actions canonical + python/assembler cues)`,
);
