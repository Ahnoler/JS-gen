#!/usr/bin/env node
/**
 * Characterization: shared sanitizeTranscationName (transaction-name.js).
 *
 * Asserts:
 *   - transaction-name.js exports sanitizeTranscationName
 *   - the regex replaces [\/:*?"<>|'] with '_'
 *   - transaction-export-v3.js and transaction-export.js both import and use it
 *   - sample cases: '测试/交易:名称' → '测试_交易_名称', normal Chinese, empty string
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { sanitizeTranscationName } from '../../src/services/transaction-name.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');

let failures = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.log(`  ✗ ${msg}`);
    failures += 1;
  }
}

// ── Source-level: transaction-name.js exports + regex ──────────────────────
const tnSrc = readFileSync(join(ROOT, 'src', 'services', 'transaction-name.js'), 'utf-8');
check(tnSrc.includes('export function sanitizeTranscationName'), 'transaction-name.js exports sanitizeTranscationName');
check(tnSrc.includes("replace(/[\\\\/:*?\"<>|']/g, '_')"), 'transaction-name.js has the strip regex');

// ── Source-level: v3 + v2 import and use shared sanitize ───────────────────
const v3Src = readFileSync(join(ROOT, 'src', 'services', 'transaction-export-v3.js'), 'utf-8');
check(v3Src.includes("from './transaction-name.js'") && v3Src.includes('sanitizeTranscationName'), 'transaction-export-v3.js imports sanitizeTranscationName');
check(v3Src.includes('sanitizeTranscationName(String(traj.name'), 'transaction-export-v3.js uses sanitizeTranscationName in name assembly');

const v2Src = readFileSync(join(ROOT, 'src', 'services', 'transaction-export.js'), 'utf-8');
check(v2Src.includes("from './transaction-name.js'") && v2Src.includes('sanitizeTranscationName'), 'transaction-export.js imports sanitizeTranscationName');
check(v2Src.includes('sanitizeTranscationName(String(traj.name'), 'transaction-export.js uses sanitizeTranscationName in name assembly');

// ── Functional: sample cases via direct import ─────────────────────────────
console.log('[functional] sanitizeTranscationName samples');
check(sanitizeTranscationName('测试/交易:名称') === '测试_交易_名称', '测试/交易:名称 → 测试_交易_名称');
check(sanitizeTranscationName('正常中文交易') === '正常中文交易', 'normal Chinese unchanged');
check(sanitizeTranscationName('') === '', 'empty string → empty');
check(sanitizeTranscationName(null) === '', 'null → empty');
check(sanitizeTranscationName('a\\b') === 'a_b', 'backslash replaced');
check(sanitizeTranscationName('a|b') === 'a_b', 'pipe replaced');
check(sanitizeTranscationName("a'b") === 'a_b', 'quote replaced');
check(sanitizeTranscationName('a:b') === 'a_b', 'colon replaced');
check(sanitizeTranscationName('a*b') === 'a_b', 'asterisk replaced');
check(sanitizeTranscationName('a?b') === 'a_b', 'question mark replaced');
check(sanitizeTranscationName('a<b>c') === 'a_b_c', 'angle brackets replaced');
check(v3Src.includes("p.propertiesName = sanitizeTranscationName(String(p.propertiesName))"), 'v3 sanitizes every propertiesName (business object name)');
check(v3Src.includes('uniquifyPropertiesNames(properties)') && v3Src.indexOf('p.propertiesName = sanitizeTranscationName') > v3Src.indexOf('uniquifyPropertiesNames(properties)'), 'v3 propertiesName sanitize runs after uniquify');

if (failures) {
  console.log(`FAIL: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('OK: shared sanitizeTranscationName (transaction-name.js, v3/v2 import, sample cases)');