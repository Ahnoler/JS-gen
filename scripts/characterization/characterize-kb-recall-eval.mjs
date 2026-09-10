/**
 * Characterization gate: KB recall quality metrics over the frozen eval set
 * (spec 2026-09-09-kb-recall-eval-design §8.2; plan Task 4).
 *
 * Thresholds are the G2-approved regression floors (2026-09-10, unconditional;
 * derivation in docs/superpowers/reports/2026-09-09-kb-recall-eval-baseline.md §T4):
 *   Acc@1 >= 0.600 / Recall@5 >= 0.707 / MRR@5 >= 0.614 / nDCG@5 >= 0.628
 *   rejection >= 0.583 / noise Acc@1 >= 0.550; warm p95 <= 50ms, cold p95 <= 200ms.
 * Threshold changes require Lead approval (D4/D7) and must land in the same
 * commit as any eval-fixture version bump.
 *
 * Single metrics engine: reuses runRecallEval / compareWithBaseline from
 * scripts/kb/recall-eval.mjs — no second metric implementation here.
 *
 * Run:
 *   node scripts/characterization/characterize-kb-recall-eval.mjs
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import {
  loadEvalFixture,
  runRecallEval,
  compareWithBaseline,
  DEFAULT_MARGINS,
  LATENCY_BUDGETS_MS,
  DEFAULT_FIXTURE,
} from '../kb/recall-eval.mjs';
import { listFlowCardsDetailed } from '../../src/services/kb-flow-cards.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const APPROVED = {
  accuracyAt1: 0.6,
  recallAt5: 0.707,
  mrrAt5: 0.614,
  ndcgAt5: 0.628,
  rejectionRate: 0.583,
  noiseAccuracyAt1: 0.55,
};

/**
 * G2-approved floors + D11 margins, expressed as a baseline snapshot so
 * compareWithBaseline computes floor = APPROVED (floor == baseline - margin).
 * Asserted equal to DEFAULT_MARGINS so the runner's --baseline mode and this
 * gate can never drift apart silently.
 */
const APPROVED_BASELINE = Object.fromEntries(
  Object.entries(APPROVED).map(([k, v]) => [k, +(v + DEFAULT_MARGINS[k]).toFixed(3)]),
);

let passed = 0;

/**
 * @param {string} name Assertion name
 * @param {() => void | Promise<void>} fn Assertion body
 * @returns {Promise<void>}
 */
async function run(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n${e && e.message ? e.message : e}`);
    throw e;
  }
}

const fixture = loadEvalFixture(DEFAULT_FIXTURE);
const cards = await listFlowCardsDetailed({});

await run('eval fixture v1 structure: 130 entries / 30 negatives / >=50 cards / no dupes', () => {
  assert.equal(fixture.evalVersion, 'v1');
  assert.ok(fixture.entries.length >= 130, `entries ${fixture.entries.length} < 130`);
  const negatives = fixture.entries.filter((x) => x.tier === 'N');
  assert.equal(negatives.length, 30);
  const positives = fixture.entries.filter((x) => x.tier !== 'N');
  const stems = new Set(positives.flatMap((x) => x.gold));
  assert.ok(stems.size >= 50, `card coverage ${stems.size} < 50`);
  assert.equal(new Set(fixture.entries.map((x) => x.query)).size, fixture.entries.length, 'duplicate queries');
  for (const x of positives) assert.ok((x.gold || []).length, `positive without gold: ${x.id}`);
  for (const x of negatives) assert.ok(x.whyNegative, `negative without whyNegative: ${x.id}`);
  const known = new Set(cards.map((c) => c._stem));
  const stale = positives.flatMap((x) => x.gold).filter((g) => !known.has(g));
  assert.deepEqual(stale, [], `stale gold (spec §9 — Lead decides): ${[...new Set(stale)].join(', ')}`);
});

await run('gate margins stay in lockstep with runner DEFAULT_MARGINS', () => {
  // The APPROVED_BASELINE reconstruction above only equals the real approved
  // baseline when margins are unchanged; pin the pair so neither file drifts.
  assert.deepEqual(
    APPROVED_BASELINE,
    { accuracyAt1: 0.65, recallAt5: 0.757, mrrAt5: 0.694, ndcgAt5: 0.708, rejectionRate: 0.633, noiseAccuracyAt1: 0.65 },
  );
});

const result = await runRecallEval({ fixture, cards, k: 5 });
const m = result.metrics;

console.log(`eval ${result.evalVersion} (k=${result.k}) positives=${m.positives} negatives=${m.negatives}`);
console.log(`  Acc@1      ${m.accuracyAt1}`);
console.log(`  Recall@5   ${m.recallAt5}`);
console.log(`  MRR@5      ${m.mrrAt5}`);
console.log(`  nDCG@5     ${m.ndcgAt5}`);
console.log(`  拒答率     ${m.rejectionRate}  (FP: ${result.negatives.filter((x) => !x.rejected).map((x) => `${x.query}=>${x.got}`).join('; ') || 'none'})`);
console.log(`  噪声 Acc@1 ${m.noiseAccuracyAt1}  (Δ ${result.noise.delta})`);
console.log(`  延迟ms     warm p50=${m.latencyMs.warmP50} p95=${m.latencyMs.warmP95} | cold p50=${m.latencyMs.coldP50} p95=${m.latencyMs.coldP95}`);
const byTier = {};
for (const q of result.perQuery) {
  byTier[q.tier] = byTier[q.tier] || { n: 0, ok: 0 };
  byTier[q.tier].n += 1;
  byTier[q.tier].ok += q.ok ? 1 : 0;
}
console.log(`  分层 Acc@1  ${Object.entries(byTier).map(([t, v]) => `${t} ${v.ok}/${v.n}=${(v.ok / v.n).toFixed(2)}`).join('  ')}`);

await run('approved metric floors hold (compareWithBaseline, D11 margins)', () => {
  const diff = compareWithBaseline(result, { metrics: APPROVED_BASELINE });
  for (const r of diff.rows) {
    console.log(`    ${r.ok ? 'OK ' : 'FAIL'} ${r.metric}: current=${r.current} floor=${r.floor} (baseline=${r.baseline} margin=${DEFAULT_MARGINS[r.metric]})`);
  }
  if (!diff.pass) {
    const fails = result.perQuery.filter((q) => !q.ok);
    console.error('  退化明细 perQuery (first 20):');
    for (const f of fails.slice(0, 20)) {
      console.error(`    MISS ${f.id} 「${f.query}」 top1=${f.top5[0] ?? 'null'} gold=${f.gold.join('|')} rank=${f.rank ?? '-'}`);
    }
  }
  assert.ok(diff.pass, `metrics below approved floors: ${diff.rows.filter((r) => !r.ok).map((r) => r.metric).join(', ')}`);
});

await run('latency budgets hold (warm p95 <= 50ms, cold p95 <= 200ms)', () => {
  assert.ok(m.latencyMs.warmP95 <= LATENCY_BUDGETS_MS.warmP95, `warmP95 ${m.latencyMs.warmP95}ms > ${LATENCY_BUDGETS_MS.warmP95}ms`);
  assert.ok(m.latencyMs.coldP95 <= LATENCY_BUDGETS_MS.coldP95, `coldP95 ${m.latencyMs.coldP95}ms > ${LATENCY_BUDGETS_MS.coldP95}ms`);
});

console.log(`\ncharacterize-kb-recall-eval: ${passed} passed`);
