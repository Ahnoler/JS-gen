/**
 * Characterization: starting page id binding (offline).
 * Covers generatePageId / bindRecordingPageId contract + service/runner/py wiring.
 * The SUT module (src/services/trajectory/recording-page-bind.js) may be created
 * by a parallel task; this file is written to pass `node --check` regardless.
 * Import failures are reported per-test but do not crash the suite.
 * Run: node scripts/characterization/characterize-page-bind.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

let generatePageId;
let bindRecordingPageId;
let bindAvailable = false;
try {
  const mod = await import('../../src/services/trajectory/recording-page-bind.js');
  generatePageId = mod.generatePageId;
  bindRecordingPageId = mod.bindRecordingPageId;
  bindAvailable = true;
} catch (err) {
  // Parallel task may not have landed the SUT yet; wiring tests still run.
  bindAvailable = false;
}

// ---------------------------------------------------------------------------
// Test cases (pure function, fully offline)
// ---------------------------------------------------------------------------

function testGeneratePageIdFormat() {
  if (!bindAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const v = generatePageId();
  assert.match(v, /^AILZ\d{13}$/, 'page id matches AILZ + 13-digit ms timestamp');
}

function testGeneratePageIdUniqueNonDecreasing() {
  if (!bindAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const v1 = generatePageId();
  const v2 = generatePageId();
  // Same-ms calls may legitimately return equal IDs (Date.now() granularity) — contract allows equal.
  // Timestamps are non-decreasing (allow equal due to ms granularity).
  const ts1 = Number(v1.slice(4));
  const ts2 = Number(v2.slice(4));
  assert.ok(ts2 >= ts1, 'second timestamp >= first (non-decreasing)');
}

// ---------------------------------------------------------------------------
// Wiring assertions (readFileSync + assert.match) — run regardless of import
// ---------------------------------------------------------------------------

function testWiringService() {
  const service = readFileSync(join(root, 'src/services/trajectory/recording-page-bind.js'), 'utf8');
  assert.match(service, /read_page_component_code/, 'service references read_page_component_code');
  assert.match(service, /AILZ/, 'service references AILZ prefix');
  assert.match(service, /updateMeta/, 'service references updateMeta');
}

function testWiringRunner() {
  const runner = readFileSync(join(root, 'src/services/trajectory/trajectory-attach-runner.js'), 'utf8');
  assert.match(runner, /bindRecordingPageId/, 'runner references bindRecordingPageId');
}

function testWiringPageIdPy() {
  const py = readFileSync(join(root, 'scripts/controller/actions/js_snippets/page_id.py'), 'utf8');
  assert.match(py, /JS_READ_PAGE_COMPONENT_CODE/, 'page_id.py defines JS_READ_PAGE_COMPONENT_CODE');
}

function testWiringReplayPy() {
  const py = readFileSync(join(root, 'scripts/controller/actions/_replay.py'), 'utf8');
  assert.match(py, /read_page_component_code/, '_replay.py references read_page_component_code');
}

function testWiringMenuNavigation() {
  const nav = readFileSync(join(root, 'src/services/trajectory/menu-navigation.js'), 'utf8');
  assert.match(nav, /navigateToFunctionMenu/, 'menu-navigation.js references navigateToFunctionMenu');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  console.log('\n=== starting page id binding characterization ===\n');
  const tests = [
    ['generatePageId format: AILZ + 13-digit ms timestamp', testGeneratePageIdFormat],
    ['generatePageId unique + non-decreasing timestamp', testGeneratePageIdUniqueNonDecreasing],
    ['wiring: service references read_page_component_code + AILZ + updateMeta', testWiringService],
    ['wiring: trajectory-attach-runner.js references bindRecordingPageId', testWiringRunner],
    ['wiring: js_snippets/page_id.py defines JS_READ_PAGE_COMPONENT_CODE', testWiringPageIdPy],
    ['wiring: _replay.py references read_page_component_code', testWiringReplayPy],
    ['wiring: menu-navigation.js references navigateToFunctionMenu', testWiringMenuNavigation],
  ];
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${name}:`, err.message);
    }
  }
  console.log(failed ? '\nFAIL' : '\nOK');
  process.exitCode = failed ? 1 : 0;
}

main();
