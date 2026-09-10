/**
 * KB coverage retrospective — Task 1: measurement engine M1–M6.
 *
 * Offline recomputable from the frozen fixture only (spec §4). Three mapping
 * chains, each recording its hit source for audit:
 *   ① ZJJK   — trajectory.page_id ∈ card.hash_markers (ZJJK codes)
 *   ② FS     — system_page.res_path of the trajectory's page embeds an FS
 *              code ∈ card.hash_markers
 *   ③ ROUTE  — system_page.res_path contains a card hash_marker route
 *              fragment (len ≥ 4, non-UML)
 * Multi-label: every hit card is recorded; primaryCard = the hit from the
 * highest-priority chain (ZJJK > FS > ROUTE), first stem alphabetically for
 * stability. Anti-cheat rules (spec §4): task text is NOT used for matching;
 * function_id is NOT a card mapping key (reported as a fact only).
 *
 * Determinism: object keys are inserted in sorted order where iteration
 * order could leak into output; same fixture ⇒ byte-identical output.
 *
 * Run: node scripts/kb/kb-coverage.mjs [--fixture path] [--json] [--baseline path]
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_FIXTURE = resolve(ROOT, 'scripts/characterization/fixtures/kb-coverage.v1.json');
const FLOWS_DIR = resolve(ROOT, 'data/kb/flows');

/**
 * Load the 84 flow cards (read-only) and index their hash_markers per chain.
 * @param {string} flowsDir Cards directory
 * @returns {{cards: Array<object>, zj: Map<string, Set<string>>, fs: Map<string, Set<string>>, route: Map<string, Set<string>>}} Card corpus + per-chain marker index
 */
export function loadCardCorpus(flowsDir = FLOWS_DIR) {
  const cards = [];
  const zj = new Map();
  const fs = new Map();
  const route = new Map();
  for (const f of readdirSync(flowsDir).filter((x) => x.endsWith('.json')).sort()) {
    const card = JSON.parse(readFileSync(`${flowsDir}/${f}`, 'utf8'));
    const stem = f.replace(/\.json$/, '');
    card._stem = stem;
    cards.push(card);
    for (const m of card.hash_markers || []) {
      let target = null;
      if (/^ZJJK\d+$/.test(m)) target = zj;
      else if (/^FS\d+$/.test(m)) target = fs;
      else if (!/^UML/.test(m)) target = route;
      if (target) {
        if (!target.has(m)) target.set(m, new Set());
        target.get(m).add(stem);
      }
    }
  }
  return { cards, zj, fs, route };
}

/**
 * Map one trajectory to cards via the three chains (multi-label).
 * @param {{pageId: string|null, urlCodes: object|null}} traj Redacted trajectory
 * @param {Map<string, object>} pageByPageId pageId → system_page row
 * @param {{zj: Map<string, Set<string>>, fs: Map<string, Set<string>>, route: Map<string, Set<string>>}} chains Marker indexes
 * @returns {{cards: string[], chains: string[]}} Hit card stems (sorted) + hit chain names
 */
export function mapTrajectory(traj, pageByPageId, chains) {
  const hits = new Map(); // stem -> best chain rank
  const chainHits = new Set();
  const consider = (stems, chain, rank) => {
    for (const s of stems) {
      const prev = hits.get(s);
      if (prev === undefined || rank < prev) hits.set(s, rank);
    }
    chainHits.add(chain);
  };
  if (traj.pageId) {
    if (chains.zj.has(traj.pageId)) consider(chains.zj.get(traj.pageId), 'ZJJK', 1);
    const page = pageByPageId.get(traj.pageId);
    const resPath = (page && page.resPath) || '';
    const fsInPath = resPath.match(/FS\d{8,12}/);
    if (fsInPath && chains.fs.has(fsInPath[0])) consider(chains.fs.get(fsInPath[0]), 'FS', 2);
    if (resPath) {
      for (const [frag, stems] of chains.route) {
        if (frag.length >= 4 && resPath.includes(frag)) consider(stems, 'ROUTE', 3);
      }
    }
  }
  const cards = [...hits.keys()].sort();
  return { cards, chains: [...chainHits].sort() };
}

/**
 * Longest common subsequence length (order-agreement denominator side).
 * @param {string[]} a Sequence A
 * @param {string[]} b Sequence B
 * @returns {number} LCS length
 */
function lcsLength(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Card node page names, normalized (strip punctuation/whitespace) for region matching.
 * @param {unknown} s Page-name-like value
 * @returns {string} Normalized string
 */
const normPage = (s) => String(s || '').replace(/[\s（）()/、·]/g, '');

/**
 * Compute M1–M6 + lists from a fixture + card corpus.
 * @param {object} fixture Frozen snapshot fixture
 * @param {object} [corpus] Preloaded card corpus (defaults to data/kb/flows)
 * @returns {object} Metrics, lists, and attribution details
 */
export function computeCoverage(fixture, corpus) {
  const { cards, zj, fs, route } = corpus || loadCardCorpus();
  const stems = cards.map((c) => c._stem).sort();
  const pageByPageId = new Map((fixture.pages || []).map((p) => [p.pageId, p]));

  // ---- M1 joinability: cards with >=1 connectable code ----
  const cardChain = new Map(); // stem -> Set<chain>
  for (const c of cards) {
    const chains = new Set();
    for (const m of c.hash_markers || []) {
      if (/^ZJJK\d+$/.test(m)) chains.add('ZJJK');
      else if (/^FS\d+$/.test(m)) chains.add('FS');
      else if (!/^UML/.test(m)) chains.add('ROUTE');
    }
    cardChain.set(c._stem, chains);
  }
  const joinable = stems.filter((s) => cardChain.get(s).size > 0);
  const noCodeCards = stems.filter((s) => cardChain.get(s).size === 0);
  const m1 = { joinability: joinable.length / stems.length, joinableCards: joinable.length, denominator: stems.length, noCodeCards };

  // ---- trajectory-side mapping (multi-label + primaryCard) ----
  const eligible = fixture.trajectories.filter((t) => t.recordStatus === 'recorded' || t.recordStatus === 'completed');
  const withPageId = eligible.filter((t) => t.pageId);
  /** @type {Map<string, {cards: string[], chains: string[]}>} */
  const trajMap = new Map();
  let multiCard = 0;
  for (const t of eligible) {
    if (!t.pageId) continue;
    const { cards: hitCards, chains } = { ...mapTrajectory(t, pageByPageId, { zj, fs, route }) };
    if (hitCards.length > 0) {
      trajMap.set(t.id, { cards: hitCards, chains });
      if (hitCards.length > 1) multiCard += 1;
    }
  }
  const mapAmbiguityRate = withPageId.length > 0 ? multiCard / withPageId.length : 0;

  // ---- M2 coverage ----
  const m2 = {
    coverage: withPageId.length > 0 ? trajMap.size / withPageId.length : 0,
    mappedTrajectories: trajMap.size,
    denominator: withPageId.length,
    denominatorNote: 'recorded+completed trajectories with page_id',
  };

  // ---- M3 utilization + dead cards ----
  const hitCards = new Set();
  for (const { cards: cs } of trajMap.values()) for (const c of cs) hitCards.add(c);
  const deadCards = stems.filter((s) => !hitCards.has(s));
  const m3 = {
    utilization: hitCards.size / stems.length,
    utilizedCards: hitCards.size,
    denominator: stems.length,
    deadCardCount: deadCards.length,
    deadCards,
  };

  // ---- M4 uncovered Top20 (by pageId x count; pageId absent -> page name family) ----
  const missCount = new Map();
  for (const t of eligible) {
    if (!t.pageId) continue;
    if (trajMap.has(t.id)) continue;
    missCount.set(t.pageId, (missCount.get(t.pageId) || 0) + 1);
  }
  const pageName = (pid) => {
    const p = pageByPageId.get(pid);
    return p && p.pageName ? p.pageName : null;
  };
  const uncoveredTop = [...missCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([pid, n]) => ({ pageId: pid, count: n, pageName: pageName(pid), inSystemPage: pageByPageId.has(pid) }));
  const m4 = {
    uncoveredTrajectories: [...missCount.values()].reduce((x, y) => x + y, 0),
    distinctUncoveredPages: missCount.size,
    top: uncoveredTop,
  };

  // ---- M5 node agreement (on mapped trajectories only) ----
  const cardByStem = new Map(cards.map((c) => [c._stem, c]));
  let nodeCoverSum = 0;
  let orderAgreeSum = 0;
  let offCardHits = 0;
  let regionHitsTotal = 0;
  let mappedWithRegions = 0;
  for (const [tid, { cards: cs }] of trajMap) {
    const t = eligible.find((x) => x.id === tid);
    const regions = (t.visitedRegions || []).map((r) => normPage(r.label)).filter(Boolean);
    if (regions.length === 0) continue;
    mappedWithRegions += 1;
    regionHitsTotal += regions.length;
    // primary card = first of the sorted hit list (chain-rank + alpha stable)
    const card = cardByStem.get(cs[0]);
    const cardPages = (card.nodes || []).map((n) => normPage(n.page)).filter(Boolean);
    if (cardPages.length === 0) continue;
    let covered = 0;
    for (const rp of regions) {
      if (cardPages.some((cp) => cp.includes(rp) || rp.includes(cp))) covered += 1;
      else offCardHits += 1;
    }
    nodeCoverSum += covered / regions.length;
    orderAgreeSum += regions.length > 0 ? lcsLength(regions, cardPages) / regions.length : 0;
  }
  const m5 = {
    nodeCoverage: mappedWithRegions > 0 ? nodeCoverSum / mappedWithRegions : null,
    orderAgreement: mappedWithRegions > 0 ? orderAgreeSum / mappedWithRegions : null,
    offCardRate: regionHitsTotal > 0 ? offCardHits / regionHitsTotal : null,
    denominator: { mappedTrajectories: trajMap.size, withVisitedRegions: mappedWithRegions },
  };

  // ---- M6 freshness: card ZJJK/FS markers still present in system_page ----
  const pageIdSet = new Set(fixture.pages.map((p) => p.pageId));
  const stale = [];
  let freshMarkers = 0;
  let totalMarkers = 0;
  const staleCards = [];
  for (const c of cards) {
    const codes = (c.hash_markers || []).filter((m) => /^(ZJJK|FS)\d+$/.test(m));
    if (codes.length === 0) continue;
    totalMarkers += codes.length;
    let staleInCard = 0;
    for (const code of codes) {
      if (pageIdSet.has(code)) freshMarkers += 1;
      else staleInCard += 1;
    }
    if (staleInCard > 0) {
      staleCards.push({ stem: c._stem, staleMarkers: codes.filter((x) => !pageIdSet.has(x)), totalCodes: codes.length });
    }
  }
  const m6 = {
    freshness: totalMarkers > 0 ? freshMarkers / totalMarkers : null,
    freshMarkers,
    staleMarkers: totalMarkers - freshMarkers,
    staleCardCount: staleCards.length,
    staleCards,
  };

  // ---- chain attribution + facts ----
  const chainDist = { ZJJK: 0, FS: 0, ROUTE: 0 };
  for (const { chains: chs } of trajMap.values()) for (const ch of chs) chainDist[ch] += 1;
  const functionIdFacts = {
    distinctFunctionIds: new Set(eligible.map((t) => t.functionId).filter(Boolean)).size,
    note: 'function_id is a product transaction id — reported as a fact, NOT used as a card mapping key (spec §4)',
  };

  return {
    fixtureVersion: fixture.snapshotVersion,
    metrics: { m1, m2, m3, m4, m5, m6 },
    attribution: { chainDistribution: chainDist, mapAmbiguityRate: mapAmbiguityRate, multiCardTrajectories: multiCard, functionIdFacts },
    lists: { deadCards, uncoveredTop, staleCards },
    cardStems: stems,
  };
}

/** CLI entry: --fixture / --json / --baseline. */
function main() {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const fixturePath = get('--fixture', DEFAULT_FIXTURE);
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const result = computeCoverage(fixture);

  if (args.includes('--baseline')) {
    const baseline = JSON.parse(readFileSync(get('--baseline', ''), 'utf8'));
    const FLOORS = ['m1.joinability', 'm2.coverage', 'm3.utilization', 'm5.nodeCoverage', 'm5.orderAgreement'];
    const MARGIN = 0.05;
    let pass = true;
    const rows = [];
    for (const path of FLOORS) {
      const cur = path.split('.').reduce((o, k) => o[k], result.metrics);
      const base = path.split('.').reduce((o, k) => o[k], baseline.metrics);
      const floor = +(base - 0.05).toFixed(3);
      const ok = cur >= floor;
      rows.push({ metric: path, current: cur, baseline: base, floor, ok });
      if (!ok) pass = false;
    }
    result.baselineDiff = { rows, pass };
    if (!args.includes('--json')) {
      for (const r of rows) console.log(`  ${r.ok ? 'OK ' : 'FAIL'} ${r.metric}: current=${r.current} baseline=${r.baseline} floor=${r.floor}`);
    }
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const { m1, m2, m3, m4, m5, m6 } = result.metrics;
    console.log(`M1 joinability   ${m1.joinability}  (${m1.joinableCards}/${m1.denominator}; no-code cards: ${m1.noCodeCards.length})`);
    console.log(`M2 coverage      ${m2.coverage}  (${m2.mappedTrajectories}/${m2.denominator})`);
    console.log(`M3 utilization   ${m3.utilization}  (${m3.utilizedCards}/${m3.denominator}; dead: ${m3.deadCardCount})`);
    console.log(`M4 uncovered     ${m4.uncoveredTrajectories} trajs / ${m4.distinctUncoveredPages} pages (top: ${m4.top[0] ? m4.top[0].pageId + '×' + m4.top[0].count : '-'})`);
    console.log(`M5 nodeCoverage  ${m5.nodeCoverage}  orderAgreement ${m5.orderAgreement}  offCardRate ${m5.offCardRate}  (n=${m5.denominator.withVisitedRegions})`);
    console.log(`M6 freshness     ${m6.freshness}  (${m6.freshMarkers}/${m6.freshMarkers + m6.staleMarkers}; stale cards: ${m6.staleCardCount})`);
  }
  if (result.baselineDiff && !result.baselineDiff.pass) process.exitCode = 1;
}

main();
