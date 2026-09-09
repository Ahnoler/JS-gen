/**
 * Characterization: navigable uml_ecd guard (xpath+uml unique).
 * Run: node scripts/characterization/characterize-menu-uml-ecd-nav-guard.mjs
 *
 * Task 1 (red): import + pure isNavigableUmlPair pins; module missing → FAIL.
 * Task 4: apply/import wiring asserts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertUmlEcdNavAvailable,
  isNavigableUmlPair,
} from '../../src/services/menu-uml-ecd-nav-guard.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GUARD_PATH = path.join(ROOT, 'src/services/menu-uml-ecd-nav-guard.js');
const APPLY_PATH = path.join(ROOT, 'src/services/menu-scan-apply.js');
const IMPORT_PATH = path.join(ROOT, 'src/services/menu-json-import.js');

function testGuardModuleExists() {
  assert.ok(fs.existsSync(GUARD_PATH), 'missing menu-uml-ecd-nav-guard.js');
}

function testIsNavigableUmlPair() {
  assert.equal(isNavigableUmlPair('UML1', "//li[@data-id='1']"), true);
  assert.equal(isNavigableUmlPair('UML1', ''), false);
  assert.equal(isNavigableUmlPair('', "//li"), false);
  assert.equal(isNavigableUmlPair('  ', '  /x  '), false);
  assert.equal(isNavigableUmlPair(' UML1 ', ' /x '), true);
}

function testExports() {
  assert.equal(typeof assertUmlEcdNavAvailable, 'function');
  const guard = fs.readFileSync(GUARD_PATH, 'utf8');
  assert.match(guard, /export async function assertUmlEcdNavAvailable/);
  assert.match(guard, /CONFLICT/);
}

function testWiringApplyImport() {
  const apply = fs.readFileSync(APPLY_PATH, 'utf8');
  assert.match(apply, /assertUmlEcdNavAvailable/);
  const imp = fs.readFileSync(IMPORT_PATH, 'utf8');
  assert.match(imp, /assertUmlEcdNavAvailable/);
}

function main() {
  console.log('\n=== menu-uml-ecd-nav-guard characterization ===\n');
  const tests = [
    ['guard module exists', testGuardModuleExists],
    ['isNavigableUmlPair', testIsNavigableUmlPair],
    ['assertUmlEcdNavAvailable export', testExports],
    ['wiring: apply+import call assertUmlEcdNavAvailable', testWiringApplyImport],
  ];
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed += 1;
      console.error(`  ✗ ${name}:`, e.message);
    }
  }
  console.log(failed ? '\nFAIL' : '\nOK');
  process.exitCode = failed ? 1 : 0;
}

main();
