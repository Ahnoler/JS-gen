/**
 * req-draft-traj FK guard characterization (offline, no DB).
 * Pins: propose-side suggestedFunctionId normalization (hallucinated system
 * ids nulled before cache write) + commit-side unknown_function_id skip,
 * both with fail-open semantics on DB lookup errors.
 * Run: node scripts/characterization/characterize-req-draft-fk-guard.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const propose = readFileSync(join(root, 'src/services/req-draft-traj/propose.js'), 'utf8');
const commit = readFileSync(join(root, 'src/services/req-draft-traj/commit.js'), 'utf8');

const normalizeCall = 'await normalizeSuggestedFunctionIds(capped, functionIdExists);';

const checks = [
  ['propose: system-dao namespace import wired',
    propose.includes("import * as systemDao from '../../dao/system-dao.js';")],
  ['propose: normalize helper defined (injectable existsFn)',
    propose.includes('async function normalizeSuggestedFunctionIds(atoms, existsFn = null)')],
  ['propose: normalize awaited before propose-cache write',
    propose.includes(normalizeCall)
    && propose.indexOf(normalizeCall) < propose.indexOf('await writeProposeCache(')],
  ['propose: unknown id nulled in place on the atom',
    propose.includes('atom.suggestedFunctionId = null')],
  ['propose: null-out warn message',
    propose.includes('not found in system — nulled')],
  ['propose: fail-safe skip-validation warn on DB error',
    propose.includes('skip validation')],
  ['commit: system-dao namespace import wired',
    commit.includes("import * as systemDao from '../../dao/system-dao.js';")],
  ['commit: unknown_function_id skip reason',
    commit.includes("'unknown_function_id'")],
  ['commit: existence guard defaults to systemDao.getById',
    commit.includes('existsFn || ((id) => systemDao.getById(id))')],
  ['commit: guard call threads functionIdExists injection',
    commit.includes('isKnownFunctionId(functionId, functionIdExists)')],
  ['commit: fail-open warn on lookup error',
    commit.includes('fail-open')],
];

let failed = 0;
for (const [label, ok] of checks) {
  if (!ok) {
    failed += 1;
    console.error(`MISSING marker — ${label}`);
  }
}

if (failed > 0) {
  console.error(`characterize-req-draft-fk-guard: FAIL ${checks.length - failed}/${checks.length}`);
  process.exit(1);
}
console.log(`characterize-req-draft-fk-guard: OK ${checks.length}/${checks.length}`);
