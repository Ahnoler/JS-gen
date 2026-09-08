/**
 * Read-only stats over data/kb/staging/propose-runs.jsonl (spec Task 10).
 *
 * Usage:
 *   node scripts/kb/propose-stats.mjs [--file <path>] [--module <moduleKey>]
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const file = flag('--file') ?? join(ROOT, 'data', 'kb', 'staging', 'propose-runs.jsonl');
const moduleFilter = flag('--module');

let raw = '';
try {
  raw = await readFile(file, 'utf-8');
} catch {
  console.error(`no propose-runs.jsonl at ${file} — run draft-traj/propose first`);
  process.exit(1);
}

/** @type {Array<Record<string, unknown>>} */
const runs = raw.split('\n').filter((l) => l.trim()).map((l) => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean).filter((r) => !moduleFilter || r.moduleKey === moduleFilter);

if (!runs.length) {
  console.log(moduleFilter ? `no runs for module ${moduleFilter}` : 'no runs recorded');
  process.exit(0);
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const atoms = runs.map((r) => Number(r.atoms) || 0);
const durations = runs.map((r) => Number(r.durationMs) || 0);
const flowHits = runs.map((r) => Number(r.flowRefHits) || 0);
const candHits = runs.map((r) => Number(r.functionIdCandidateHits) || 0);
const byModule = {};
for (const r of runs) {
  byModule[r.moduleKey] = (byModule[r.moduleKey] || 0) + 1;
}

console.log(JSON.stringify({
  file,
  runs: runs.length,
  byModule,
  atoms: { total: sum(atoms), avg: Math.round((sum(atoms) / runs.length) * 10) / 10 },
  flowRefHitRate: sum(atoms) ? Math.round((sum(flowHits) / sum(atoms)) * 100) + '%' : 'n/a',
  candidateHitRate: sum(atoms) ? Math.round((sum(candHits) / sum(atoms)) * 100) + '%' : 'n/a',
  durationMs: { avg: Math.round(sum(durations) / runs.length), max: Math.max(...durations) },
  lastRun: runs[runs.length - 1],
}, null, 2));
