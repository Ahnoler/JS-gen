/**
 * Characterization: src/ctrl-actions.js surface + sync cues with Python snippets.
 *
 * Run:
 *   node scripts/characterize-ctrl.mjs
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  CTRL_API_TABLE,
  CTRL_OBJECT,
  getInjectionCode,
} from '../src/ctrl-actions.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const REQUIRED_METHODS = [
  'getContainer',
  'fillFormField',
  'selectOption',
  'selectDate',
  'clickRadio',
  'selectTreeOption',
  'clickMenuItem',
  'clickTableRowButton',
  'clickTableRowRadio',
  'closeDialog',
  'waitForLoading',
  'switchTab',
  'checkFieldValue',
  'clickAdjacentButton',
  'fillAddressFields',
  'expandAllTreeNodes',
];

function methodPresent(name) {
  // CTRL_OBJECT is a template string literal: `name: (` or `name: async`
  const re = new RegExp(`\\b${name}\\s*:`);
  return re.test(CTRL_OBJECT);
}

function testCtrlObjectMethods() {
  for (const name of REQUIRED_METHODS) {
    assert(methodPresent(name), `CTRL_OBJECT missing method: ${name}`);
  }
}

function testApiTableDocumentsMethods() {
  for (const name of REQUIRED_METHODS) {
    if (name === 'getContainer') continue; // helper, not in public API table
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

function testPythonSnippetParityCues() {
  const here = dirname(fileURLToPath(import.meta.url));
  const snippets = readFileSync(join(here, 'actions/_js_snippets.py'), 'utf8');
  // Shared Element UI container strategy must stay aligned
  assert(snippets.includes('JS_GET_CONTAINER'), 'Python must define JS_GET_CONTAINER');
  assert(snippets.includes('.el-dialog'), 'Python container must know el-dialog');
  assert(snippets.includes('.el-drawer'), 'Python container must know el-drawer');
  assert(snippets.includes('JS_FILL_FORM_FIELD'), 'Python must define JS_FILL_FORM_FIELD');
  assert(snippets.includes('JS_SELECT_OPTION'), 'Python must define JS_SELECT_OPTION');
  assert(snippets.includes('JS_CLICK_RADIO'), 'Python must define JS_CLICK_RADIO');
  // Native setter pattern (Element UI) — both sides rely on it for inputs
  assert(
    CTRL_OBJECT.includes('HTMLInputElement') || CTRL_OBJECT.includes('setAttribute'),
    'CTRL fill path should use native setter / attribute pattern',
  );
  assert(
    snippets.includes('HTMLInputElement') || snippets.includes('native'),
    'Python fill snippet should reference native setter pattern',
  );
}

function testAssemblerLoadsCtrl() {
  const here = dirname(fileURLToPath(import.meta.url));
  const assembler = readFileSync(join(here, 'script_assembler.py'), 'utf8');
  assert(
    assembler.includes('ctrl-actions.js') || assembler.includes('getInjectionCode'),
    'script_assembler should load CTRL from ctrl-actions.js',
  );
}

testCtrlObjectMethods();
testApiTableDocumentsMethods();
testInjectionCode();
testPythonSnippetParityCues();
testAssemblerLoadsCtrl();
console.log('ok: characterization CTRL (ctrl-actions + python snippet cues)');
