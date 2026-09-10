/**
 * KB recall quality eval runner (spec 2026-09-09-kb-recall-eval-design §6/§8).
 *
 * Runs the frozen eval fixture (kb-recall-eval.v1.json) against the real
 * corpus via rankFlowCards real rankings (NOT leave-one-out) and emits
 * standard IR metrics: Acc@1 / Recall@5 / MRR@5 / nDCG@5 / rejection rate /
 * noise robustness / latency p50·p95 (warm + cold).
 *
 * Multi-gold accounting: per-entry Recall@k and nDCG@k credit ALL matching
 * golds fractionally (hits/|gold|), not binary any-hit; see ndcgAtK JSDoc.
 * Re-run-with-same-fixture is deterministic (no LLM in the loop), so baseline
 * diffs have zero run-to-run noise.
 *
 * Usage:
 *   node scripts/kb/recall-eval.mjs                       # table + tmp/kb-eval/<ts>.json
 *   node scripts/kb/recall-eval.mjs --json                # machine-readable stdout
 *   node scripts/kb/recall-eval.mjs --baseline <file>     # diff vs baseline, exit 1 on breach
 *   node scripts/kb/recall-eval.mjs --fixture <path> --k 5
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listFlowCardsDetailed } from '../../src/services/kb-flow-cards.js';
import { matchFlowForAtom, rankFlowCards } from '../../src/services/req-draft-traj/flow-card-recall.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DEFAULT_FIXTURE = resolve(ROOT, 'scripts/characterization/fixtures/kb-recall-eval.v1.json');
/** Unified noise clause (identical to the 2026-09-09 reviewer probe for comparability). */
export const NOISE_CLAUSE = '（顺便问一下，今天天气怎么样，晚饭吃什么）';
/** Default diff margins (spec §6 approved caps, D11) used by --baseline mode. */
export const DEFAULT_MARGINS = {
  accuracyAt1: 0.05,
  recallAt5: 0.05,
  mrrAt5: 0.08,
  ndcgAt5: 0.08,
  rejectionRate: 0.05,
  noiseAccuracyAt1: 0.10,
};
/** Hard latency budgets (spec §6). */
export const LATENCY_BUDGETS_MS = { warmP95: 50, coldP95: 200 };

/**
 * Load and structurally validate an eval fixture (spec §9: missing file or
 * version mismatch must fail loudly; positives without gold are an error).
 * @param {string} path Fixture JSON path
 * @returns {{ evalVersion: string, entries: Array<object>, excluded: Array<object> }} Validated fixture
 */
export function loadEvalFixture(path) {
  if (!existsSync(path)) {
    throw new Error(`eval fixture missing: ${path}`);
  }
  const fixture = JSON.parse(readFileSync(path, 'utf8'));
  if (!fixture.evalVersion || !Array.isArray(fixture.entries)) {
    throw new Error(`eval fixture malformed (evalVersion/entries): ${path}`);
  }
  for (const entry of fixture.entries) {
    if (!entry.id || !entry.query || !entry.tier) {
      throw new Error(`eval fixture bad entry: ${JSON.stringify(entry).slice(0, 120)}`);
    }
    if (entry.tier !== 'N' && !(entry.gold || []).length) {
      throw new Error(`eval fixture positive without gold: ${entry.id} (spec §9 — no silent skip)`);
    }
    if (entry.tier === 'N' && !entry.whyNegative) {
      throw new Error(`eval fixture negative without whyNegative: ${entry.id}`);
    }
  }
  return fixture;
}

/**
 * Single-query ranking outcome against gold.
 * @param {{ query: string, gold: string[] }} entry Eval entry
 * @param {object[]} cards Flow-card corpus
 * @param {number} k Ranking depth
 * @returns {{ top5: string[], rank: number|null, ok: boolean }} top-k flowRefs, first-gold 1-based rank, top-1 hit
 */
function rankOutcome(entry, cards, k) {
  const ranked = rankFlowCards({ title: entry.query, taskDraft: '', cards, k });
  const top = (ranked.candidates || []).map((c) => c.flowRef);
  const rank = top.findIndex((s) => entry.gold.includes(s));
  return { top5: top, rank: rank >= 0 ? rank + 1 : null, ok: Boolean(top.length) && entry.gold.includes(top[0]) };
}

/**
 * nDCG@k with binary relevance; IDCG normalizes by min(|gold|, k) ideal gains.
 *
 * Multi-gold accounting (G2 review 2026-09-10, reviewer suggestion #1 — keep
 * this documented or baselines drift silently): per-entry Recall@5/nDCG@5 use
 * the *fractional* credit convention (hits / |gold|, DCG / ideal-DCG), then
 * average over entries. The reviewer's independent recompute used *binary*
 * per-entry credit (any-hit → 1) giving 0.760/0.711 vs our 0.757/0.708 — both
 * defensible; the fractional convention is canonical here because it penalizes
 * partial gold coverage on multi-gold queries. Acc@1/MRR are rank-based and
 * convention-independent.
 * @param {string[]} top Ranked flowRefs
 * @param {string[]} gold Allowed stems
 * @param {number} k Depth
 * @returns {number} nDCG in [0,1]
 */
function ndcgAtK(top, gold, k) {
  const depth = Math.min(top.length, k);
  let dcg = 0;
  for (let i = 0; i < depth; i += 1) {
    if (gold.includes(top[i])) dcg += 1 / Math.log2(i + 2);
  }
  let idcg = 0;
  for (let i = 0; i < Math.min(gold.length, k); i += 1) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg > 0 ? dcg / idcg : 0;
}

/**
 * Percentile of a sorted-ascending sample.
 * @param {number[]} sorted Sorted values
 * @param {number} q Percentile in [0,1)
 * @returns {number} Percentile value
 */
function pct(sorted, q) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

/**
 * Run the full eval: ranking metrics over positives, rejection over negatives,
 * noise robustness over A–D, warm/cold latency on the product match path.
 * @param {{ fixture: object, cards: object[], k?: number, withLatency?: boolean }} opts Eval inputs: validated fixture, real corpus, ranking depth, latency toggle
 * @returns {Promise<{ evalVersion: string, k: number, metrics: object, perQuery: Array<object>, negatives: Array<object>, noise: object }>} Eval result (metrics + per-query detail)
 */
export async function runRecallEval({ fixture, cards, k = 5, withLatency = true } = {}) {
  const positives = fixture.entries.filter((e) => e.tier !== 'N');
  const negatives = fixture.entries.filter((e) => e.tier === 'N');
  const stems = new Set(cards.map((c) => c._stem));

  const stale = positives.flatMap((e) => e.gold).filter((g) => !stems.has(g));
  if (stale.length) {
    throw new Error(`stale gold (corpus card deleted, spec §9 — Lead decides): ${[...new Set(stale)].join(', ')}`);
  }

  let acc1 = 0;
  let rec5 = 0;
  let mrr5 = 0;
  let ndcg5 = 0;
  /** @type {Array<object>} */
  const perQuery = [];
  for (const entry of positives) {
    const { top5, rank, ok } = rankOutcome(entry, cards, k);
    acc1 += ok ? 1 : 0;
    const hitsInTop = entry.gold.filter((g) => top5.slice(0, k).includes(g)).length;
    rec5 += hitsInTop / entry.gold.length;
    mrr5 += rank !== null && rank <= k ? 1 / rank : 0;
    ndcg5 += ndcgAtK(top5.slice(0, k), entry.gold, k);
    perQuery.push({ id: entry.id, tier: entry.tier, query: entry.query, gold: entry.gold, top5: top5.slice(0, k), rank, ok });
  }
  const n = positives.length;

  /** @type {Array<object>} */
  const negRows = [];
  let rejected = 0;
  for (const entry of negatives) {
    const hit = matchFlowForAtom({ title: entry.query, taskDraft: '', cards });
    const rej = hit.flowRef === null;
    if (rej) rejected += 1;
    negRows.push({ id: entry.id, query: entry.query, got: hit.flowRef, score: hit.score, rejected: rej });
  }

  let noisyAcc = 0;
  for (const entry of positives) {
    const ranked = rankFlowCards({ title: entry.query + NOISE_CLAUSE, taskDraft: '', cards, k });
    const top = (ranked.candidates || [])[0];
    if (top && entry.gold.includes(top.flowRef)) noisyAcc += 1;
  }

  const metrics = {
    accuracyAt1: +(acc1 / n).toFixed(3),
    recallAt5: +(rec5 / n).toFixed(3),
    mrrAt5: +(mrr5 / n).toFixed(3),
    ndcgAt5: +(ndcg5 / n).toFixed(3),
    rejectionRate: +(rejected / negatives.length).toFixed(3),
    noiseAccuracyAt1: +(noisyAcc / n).toFixed(3),
    positives: n,
    negatives: negatives.length,
    // Per-tier Acc@1 (G2 review 2026-09-10, reviewer suggestion #3): the
    // aggregate floor is insensitive to a B/D-tier collapse; tier splits keep
    // stratified regressions visible (tier A is the most sensitive detector).
    byTier: Object.fromEntries(Object.entries(
      perQuery.reduce((acc, q) => {
        acc[q.tier] = acc[q.tier] || { n: 0, ok: 0 };
        acc[q.tier].n += 1;
        acc[q.tier].ok += q.ok ? 1 : 0;
        return acc;
      }, {}),
    ).map(([tier, v]) => [tier, +(v.ok / v.n).toFixed(3)])),
  };

  if (withLatency) {
    const warm = [];
    for (let i = 0; i < 200; i += 1) {
      const q = positives[i % n].query;
      const t0 = process.hrtime.bigint();
      matchFlowForAtom({ title: q, taskDraft: '', cards });
      warm.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    warm.sort((a, b) => a - b);
    const cold = [];
    for (let i = 0; i < 20; i += 1) {
      const fresh = cards.map((c) => ({ ...c }));
      const q = positives[i % n].query;
      const t0 = process.hrtime.bigint();
      matchFlowForAtom({ title: q, taskDraft: '', cards: fresh });
      cold.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    cold.sort((a, b) => a - b);
    metrics.latencyMs = {
      warmP50: +pct(warm, 0.5).toFixed(3),
      warmP95: +pct(warm, 0.95).toFixed(3),
      coldP50: +pct(cold, 0.5).toFixed(3),
      coldP95: +pct(cold, 0.95).toFixed(3),
    };
  }

  return {
    evalVersion: fixture.evalVersion,
    k,
    metrics,
    perQuery,
    negatives: negRows,
    noise: {
      accuracyAt1: metrics.noiseAccuracyAt1,
      delta: +(metrics.noiseAccuracyAt1 - metrics.accuracyAt1).toFixed(3),
    },
  };
}

/**
 * Compare a fresh eval result against a baseline snapshot (supports both the
 * eval-runner shape and the T0 probe shape: metrics read from .metrics).
 * @param {{ metrics: object }} result Fresh eval result
 * @param {object} baseline Baseline JSON (probe or runner shape)
 * @param {{ accuracyAt1?: number, recallAt5?: number, mrrAt5?: number, ndcgAt5?: number, rejectionRate?: number, noiseAccuracyAt1?: number }} [margins] Allowed drop per metric
 * @returns {{ pass: boolean, rows: Array<{ metric: string, baseline: number, current: number, floor: number, ok: boolean }>, latencyFailures: string[] }} Diff verdict
 */
export function compareWithBaseline(result, baseline, margins = DEFAULT_MARGINS) {
  const base = baseline.metrics || baseline;
  /** @type {Array<{ metric: string, baseline: number, current: number, floor: number, ok: boolean }>} */
  const rows = [];
  for (const key of Object.keys(margins)) {
    const b = base[key];
    const c = result.metrics[key];
    if (typeof b !== 'number' || typeof c !== 'number') continue;
    const floor = +(b - margins[key]).toFixed(3);
    rows.push({ metric: key, baseline: b, current: c, floor, ok: c >= floor - 1e-9 });
  }
  /** @type {string[]} */
  const latencyFailures = [];
  const lat = result.metrics.latencyMs;
  if (lat) {
    if (lat.warmP95 > LATENCY_BUDGETS_MS.warmP95) latencyFailures.push(`warmP95 ${lat.warmP95}ms > ${LATENCY_BUDGETS_MS.warmP95}ms`);
    if (lat.coldP95 > LATENCY_BUDGETS_MS.coldP95) latencyFailures.push(`coldP95 ${lat.coldP95}ms > ${LATENCY_BUDGETS_MS.coldP95}ms`);
  }
  return { pass: rows.every((r) => r.ok) && latencyFailures.length === 0, rows, latencyFailures };
}

/**
 * Render the human-readable metrics table.
 * @param {{ evalVersion: string, k: number, metrics: object, noise: object, negatives: Array<object>, perQuery: Array<object> }} result Eval result
 * @returns {string[]} Table lines
 */
function renderTable(result) {
  const m = result.metrics;
  const lines = [
    `eval ${result.evalVersion} (k=${result.k}) positives=${m.positives} negatives=${m.negatives}`,
    `  Acc@1      ${m.accuracyAt1}`,
    `  Recall@5   ${m.recallAt5}`,
    `  MRR@5      ${m.mrrAt5}`,
    `  nDCG@5     ${m.ndcgAt5}`,
    `  拒答率     ${m.rejectionRate}  (false positives: ${result.negatives.filter((x) => !x.rejected).map((x) => `${x.query}=>${x.got}`).join('; ') || 'none'})`,
    `  噪声 Acc@1 ${m.noiseAccuracyAt1}  (Δ ${result.noise.delta})`,
  ];
  if (m.latencyMs) {
    lines.push(`  延迟ms     warm p50=${m.latencyMs.warmP50} p95=${m.latencyMs.warmP95} | cold p50=${m.latencyMs.coldP50} p95=${m.latencyMs.coldP95}`);
  }
  const fails = result.perQuery.filter((q) => !q.ok);
  lines.push(`  失败条目   ${fails.length}/${result.perQuery.length}`);
  for (const f of fails) {
    lines.push(`    MISS ${f.id} 「${f.query}」 top1=${f.top5[0] ?? 'null'} gold=${f.gold.join('|')} rank=${f.rank ?? '-'}`);
  }
  const byTier = m.byTier || {};
  lines.push(`  分层 Acc@1  ${Object.entries(byTier).map(([t, v]) => `${t} ${v}`).join('  ')}`);
  return lines;
}

/**
 * CLI entry.
 * @returns {Promise<number>} Process exit code
 */
async function main() {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const jsonMode = args.includes('--json');
  const fixturePath = get('--fixture', DEFAULT_FIXTURE);
  const k = Number(get('--k', '5'));
  const baselinePath = args.includes('--baseline') ? get('--baseline', null) : null;

  const fixture = loadEvalFixture(fixturePath);
  const cards = await listFlowCardsDetailed({});
  const result = await runRecallEval({ fixture, cards, k });
  result.generatedAt = new Date().toISOString();
  result.gitHead = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
  result.corpusCards = cards.length;

  let exitCode = 0;
  if (baselinePath) {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    const diff = compareWithBaseline(result, baseline);
    result.baselineDiff = diff;
    if (!jsonMode) {
      console.log(`baseline diff vs ${baselinePath}`);
      for (const r of diff.rows) {
        console.log(`  ${r.ok ? 'OK ' : 'FAIL'} ${r.metric}: baseline=${r.baseline} current=${r.current} floor=${r.floor}`);
      }
      for (const f of diff.latencyFailures) console.log(`  FAIL latency ${f}`);
      exitCode = diff.pass ? 0 : 1;
    } else {
      exitCode = diff.pass ? 0 : 1;
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const line of renderTable(result)) console.log(line);
    if (!baselinePath) {
      mkdirSync(resolve(ROOT, 'tmp/kb-eval'), { recursive: true });
      const out = resolve(ROOT, `tmp/kb-eval/recall-eval-${Date.now()}.json`);
      writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
      console.log(`  written ${out}`);
    }
  }
  return exitCode;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error(String(e && e.message ? e.message : e));
    process.exit(2);
  });
}
