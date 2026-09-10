/**
 * Characterization gate: KB recall quality metrics over the frozen eval set
 * (spec 2026-09-10-recall-eval-v2-design §7; plan 2026-09-10-recall-eval-v2 Task 4).
 *
 * Since the v2 switch (2026-09-10) this gate reads the FROZEN v2 fixture
 * explicitly (scripts/characterization/fixtures/kb-recall-eval.v2.json);
 * the runner's DEFAULT_FIXTURE stays v1 for zero-cost historical re-runs.
 *
 * Thresholds follow decision A6: measured first on the frozen v2 fixture,
 * NOT inherited from v1. Floors = fresh v2 baseline (snapshot
 * tmp/kb-eval-v2/T4-v2.json, measured 2026-09-10, proposal in
 * docs/superpowers/reports/2026-09-10-recall-eval-v2-report.md) minus the
 * UNCHANGED D11 margins:
 *   Acc@1 >= 0.550 / Recall@5 >= 0.675 / MRR@5 >= 0.573 / nDCG@5 >= 0.587
 *   rejection >= 0.332 / noise Acc@1 >= 0.500; A-tier Acc@1 >= 0.95 (decision A5);
 *   warm p95 <= 50ms, cold p95 <= 200ms (absolute budgets unchanged).
 * Proposed values pending Lead ratification (A6); floors only ever rise.
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
} from '../kb/recall-eval.mjs';
import { listFlowCardsDetailed } from '../../src/services/kb-flow-cards.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const V2_FIXTURE = fileURLToPath(new URL('./fixtures/kb-recall-eval.v2.json', import.meta.url));
const APPROVED = {
  accuracyAt1: 0.55,
  recallAt5: 0.675,
  mrrAt5: 0.573,
  ndcgAt5: 0.587,
  rejectionRate: 0.332,
  noiseAccuracyAt1: 0.5,
};
const A_TIER_FLOOR = 0.95;

/**
 * Approved floors + D11 margins, expressed as a baseline snapshot so
 * compareWithBaseline computes floor = APPROVED (floor == baseline - margin).
 * Asserted equal to the frozen v2 measurement so the runner's --baseline mode
 * and this gate can never drift apart silently.
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

const fixture = loadEvalFixture(V2_FIXTURE);
const cards = await listFlowCardsDetailed({});

await run('eval fixture v2 structure: >=235 entries / tier quotas / E sub-patterns / >=70 cards / no dupes', () => {
  assert.equal(fixture.evalVersion, 'v2');
  assert.ok(fixture.entries.length >= 235, `entries ${fixture.entries.length} < 235 (DoD floor)`);
  const tiers = {};
  for (const x of fixture.entries) tiers[x.tier] = (tiers[x.tier] || 0) + 1;
  for (const [tier, min] of [['A', 55], ['B', 45], ['C', 20], ['D', 20], ['E', 50], ['N', 55]]) {
    assert.ok((tiers[tier] || 0) >= min, `tier ${tier} ${tiers[tier] || 0} < ${min} (spec §7 quota)`);
  }
  const negatives = fixture.entries.filter((x) => x.tier === 'N');
  const positives = fixture.entries.filter((x) => x.tier !== 'N');
  assert.ok(positives.length >= 180, `positives ${positives.length} < 180`);
  const per = {};
  for (const x of positives) for (const g of x.gold) per[g] = (per[g] || 0) + 1;
  assert.ok(Object.keys(per).length >= 70, `card coverage ${Object.keys(per).length} < 70`);
  const maxPer = Math.max(...Object.values(per));
  assert.ok(maxPer <= 4, `per-card cap exceeded: ${maxPer}`);
  assert.equal(new Set(fixture.entries.map((x) => x.query)).size, fixture.entries.length, 'duplicate queries');
  for (const x of positives) assert.ok((x.gold || []).length, `positive without gold: ${x.id}`);
  for (const x of negatives) assert.ok(x.whyNegative, `negative without whyNegative: ${x.id}`);
  const patterns = {};
  for (const x of fixture.entries.filter((y) => y.tier === 'E')) {
    assert.ok(
      ['colloquial-synonym', 'colloquial-verb', 'colloquial-domain'].includes(x.pattern),
      `E entry without valid pattern: ${x.id}`,
    );
    patterns[x.pattern] = (patterns[x.pattern] || 0) + 1;
  }
  for (const [p, min] of [['colloquial-synonym', 15], ['colloquial-verb', 15], ['colloquial-domain', 15]]) {
    assert.ok((patterns[p] || 0) >= min, `E pattern ${p} ${patterns[p] || 0} < ${min}`);
  }
  assert.ok(Array.isArray(fixture.relabels), 'relabels must be an array (default empty)');
  for (const r of fixture.relabels) assert.ok(r.why, `relabel without why: ${r.id || '?'}`);
  const known = new Set(cards.map((c) => c._stem));
  const stale = positives.flatMap((x) => x.gold).filter((g) => !known.has(g));
  assert.deepEqual(stale, [], `stale gold (spec §9 — Lead decides): ${[...new Set(stale)].join(', ')}`);
});

await run('gate margins stay in lockstep with runner DEFAULT_MARGINS', () => {
  // The APPROVED_BASELINE reconstruction above only equals the real approved
  // baseline when margins are unchanged; pin the pair so neither file drifts.
  // v2 baseline = fresh measurement on the frozen v2 fixture (decision A6,
  // measured 2026-09-10, snapshot tmp/kb-eval-v2/T4-v2.json).
  assert.deepEqual(
    APPROVED_BASELINE,
    { accuracyAt1: 0.6, recallAt5: 0.725, mrrAt5: 0.653, ndcgAt5: 0.667, rejectionRate: 0.382, noiseAccuracyAt1: 0.6 },
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
console.log(`  延迟ms     warm p50=${m.latencyMs.warmP50} p95=${m.latencyMs.warmP95} | cold p50=${m.latencyMs.coldP50} cold p95=${m.latencyMs.coldP95}`);
const byTier = {};
for (const q of result.perQuery) {
  byTier[q.tier] = byTier[q.tier] || { n: 0, ok: 0 };
  byTier[q.tier].n += 1;
  byTier[q.tier].ok += q.ok ? 1 : 0;
}
console.log(`  分层 Acc@1  ${Object.entries(byTier).map(([t, v]) => `${t} ${v.ok}/${v.n}=${(v.ok / v.n).toFixed(2)}`).join('  ')}`);

await run('A-tier Acc@1 >= 0.95 (A5: zero-tolerance regression detector)', () => {
  const a = byTier.A || { n: 0, ok: 0 };
  assert.ok(a.n > 0, 'no A-tier entries in fixture');
  const rate = a.ok / a.n;
  assert.ok(rate >= A_TIER_FLOOR - 1e-9, `A-tier Acc@1 ${a.ok}/${a.n}=${rate.toFixed(3)} < ${A_TIER_FLOOR}`);
});

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
