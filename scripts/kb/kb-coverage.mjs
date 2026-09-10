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
 * highest-priority chain (ZJJK > FS > ROUTE), first stem alphabetically as
 * tiebreak. Anti-cheat rules (spec §4): task text is NOT used for matching;
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
 * Pick the primary card by chain priority (ZJJK > FS > ROUTE), alphabetical
 * stem order as the tiebreak (G-verdict D3: the previous implementation took
 * the first alphabetically-sorted hit regardless of chain, which misassigned
 * 24/69 primary cards).
 * @param {string[]} hitCards Sorted hit card stems
 * @param {Map<string, number>} stemRank stem → best (lowest) chain rank for this trajectory
 * @returns {string|null} Primary card stem
 */
function primaryCardOf(hitCards, stemRank) {
  if (hitCards.length === 0) return null;
  return [...hitCards].sort((a, b) => stemRank.get(a) - stemRank.get(b) || a.localeCompare(b))[0];
}

/**
 * Best (lowest) chain rank at which one stem was hit for one trajectory.
 * @param {{pageId: string|null, urlCodes: object|null}} traj Redacted trajectory
 * @param {string} stem Card stem to rank
 * @param {Map<string, object>} pageByPageId pageId → system_page row
 * @param {{zj: Map<string, Set<string>>, fs: Map<string, Set<string>>, route: Map<string, Set<string>>}} chains Marker indexes
 * @returns {number} 1 (ZJJK) / 2 (FS) / 3 (ROUTE), or 99 when not actually hit
 */
function mapTrajectoryStemRank(traj, stem, pageByPageId, chains) {
  if (traj.pageId && chains.zj.get(traj.pageId)?.has(stem)) return 1;
  const page = traj.pageId ? pageByPageId.get(traj.pageId) : null;
  const resPath = (page && page.resPath) || '';
  const fsInPath = resPath.match(/FS\d{8,12}/);
  if (fsInPath && chains.fs.get(fsInPath[0])?.has(stem)) return 2;
  if (resPath && [...chains.route.values()].some((set) => set.has(stem)) &&
      [...chains.route.entries()].some(([frag, set]) => frag.length >= 4 && resPath.includes(frag) && set.has(stem))) return 3;
  return 99;
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
  /** @type {Map<string, {cards: string[], chains: string[], primaryCard: string|null}>} */
  const trajMap = new Map();
  let multiCard = 0;
  let primaryNotTopChain = 0;
  for (const t of eligible) {
    if (!t.pageId) continue;
    const { cards: hitCards, chains } = mapTrajectory(t, pageByPageId, { zj, fs, route });
    if (hitCards.length > 0) {
      const stemRank = new Map(); // per-trajectory: stem -> best chain rank
      for (const s of hitCards) stemRank.set(s, mapTrajectoryStemRank(t, s, pageByPageId, { zj, fs, route }));
      const primary = primaryCardOf(hitCards, stemRank);
      trajMap.set(t.id, { cards: hitCards, chains, primaryCard: primary });
      if (hitCards.length > 1) multiCard += 1;
      // D3 audit: how often the alphabetical-first card differs from the chain-priority primary
      if (primary !== null && hitCards[0] !== primary) primaryNotTopChain += 1;
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

  // ---- M5 node agreement (rebuilt on page identity, G-verdict D2) ----
  // Old M5 compared visitedRegions[].label (generic region names: 主区/顶栏/侧栏
  // = 47.5% of entries) against card node page names — a vocabulary-overlap
  // metric that saturated at 91.9% of its own per-trajectory matcher ceiling.
  // Rebuilt on page identity: visitedRegions[].key (redacted page_level_key,
  // host#/route) vs the primary card's ROUTE-chain hash_markers (len ≥ 4,
  // non-code) — route-to-route, same type. node.enter is a Chinese menu
  // description (NOT a route) and node.page a display name, so neither is a
  // comparable page key; route markers are the card's page-identity claims.
  // Definitions (informational, no floor until accepted — D4):
  //   pageKeyOnCardRate = per-trajectory fraction of distinct visited page keys
  //                    covered by the primary card's route markers (mean).
  //                    DEGENERATE on current data: every mapped-with-key
  //                    trajectory holds exactly ONE distinct page key, so this
  //                    equals entryOnCardRate by construction (G-recheck E1) —
  //                    rename from nodeCoverage reflects that it carries no
  //                    sequence/coverage information until multi-key
  //                    trajectories exist.
  //   entryOnCard    = first visited page key belongs to the primary card
  //   offCardRate    = visited page keys not found on the primary card / total
  //   ceiling        = per-trajectory best over ALL hit cards of that
  //                    trajectory's coverage (matcher upper bound)
  const cardByStem = new Map(cards.map((c) => [c._stem, c]));
  const routeMarkersOf = (c) => (c.hash_markers || []).filter((m) => m.length >= 4 && !/^(ZJJK|FS|UML|RES)/.test(m));
  let nodeCoverSum = 0;
  let entryOnCardSum = 0;
  let offCardPages = 0;
  let pageKeysTotal = 0;
  let mappedWithPages = 0;
  let ceilingCoverSum = 0;
  const offCardPageCounter = new Map(); // visited key -> count (not found on the primary card)
  for (const [tid, { cards: hitCards, primaryCard }] of trajMap) {
    if (!primaryCard) continue;
    const t = eligible.find((x) => x.id === tid);
    const visitedKeys = [...new Set((t.visitedRegions || []).map((r) => normPage(r.key)).filter(Boolean))];
    if (visitedKeys.length === 0) continue;
    mappedWithPages += 1;
    pageKeysTotal += visitedKeys.length;
    const lowerKeys = visitedKeys.map((k) => k.toLowerCase());
    const coveredBy = (stem) => {
      const rms = routeMarkersOf(cardByStem.get(stem)).map((m) => m.toLowerCase());
      return lowerKeys.filter((k) => rms.some((m) => k.includes(m))).length;
    };
    const primaryCovered = coveredBy(primaryCard);
    nodeCoverSum += primaryCovered / visitedKeys.length;
    entryOnCardSum += primaryCovered > 0 && routeMarkersOf(cardByStem.get(primaryCard)).some((m) => lowerKeys[0].includes(m.toLowerCase())) ? 1 : 0;
    offCardPages += visitedKeys.length - primaryCovered;
    for (let i = 0; i < visitedKeys.length; i++) {
      const rms = routeMarkersOf(cardByStem.get(primaryCard)).map((m) => m.toLowerCase());
      if (!rms.some((m) => lowerKeys[i].includes(m))) {
        const display = visitedKeys[i].replace(/^[^#]*/, '');
        offCardPageCounter.set(display, (offCardPageCounter.get(display) || 0) + 1);
      }
    }
    // ceiling: best coverage over all hit cards for this trajectory
    let best = 0;
    for (const stem of hitCards) {
      const cov = coveredBy(stem) / visitedKeys.length;
      if (cov > best) best = cov;
    }
    ceilingCoverSum += best;
  }
  const m5 = {
    metricNote: 'v2 (G-verdict D2 rebuild): visited page keys (page_level_key host#/route) vs primary card route markers — same-type page-identity comparison. Informational, no floor until accepted (D4). orderAgreement retired: LCS over label/region vocab was the saturation artifact. pageKeyOnCardRate (formerly nodeCoverage) is DEGENERATE on current data: 18/18 mapped-with-key trajectories hold exactly one distinct page key, so it equals entryOnCardRate by construction (G-recheck E1); the only provable claim is that all 18 ZJJK-mapped cards\' route markers match their entry-page route.',
    pageKeyOnCardRate: mappedWithPages > 0 ? nodeCoverSum / mappedWithPages : null,
    entryOnCardRate: mappedWithPages > 0 ? entryOnCardSum / mappedWithPages : null,
    offCardRate: pageKeysTotal > 0 ? offCardPages / pageKeysTotal : null,
    ceiling: mappedWithPages > 0 ? ceilingCoverSum / mappedWithPages : null,
    denominator: { mappedTrajectories: trajMap.size, withPageKeys: mappedWithPages, distinctPageKeys: pageKeysTotal },
    offCardTop: [...offCardPageCounter.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([k, n]) => ({ pageKey: k, count: n })),
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
    attribution: {
      chainDistribution: chainDist,
      mapAmbiguityRate: mapAmbiguityRate,
      multiCardTrajectories: multiCard,
      primaryCardMisaligned: primaryNotTopChain,
      functionIdFacts,
    },
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
    // D4: M5 floors removed — node metrics are informational until rebuilt.
    const FLOORS = ['m1.joinability', 'm2.coverage', 'm3.utilization'];
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
    console.log(`M5 pageKeyOnCard ${m5.pageKeyOnCardRate}  entryOnCard ${m5.entryOnCardRate}  offCardRate ${m5.offCardRate}  ceiling ${m5.ceiling}  (n=${m5.denominator.withPageKeys} trajs / ${m5.denominator.distinctPageKeys} keys)`);
    console.log(`M6 freshness     ${m6.freshness}  (${m6.freshMarkers}/${m6.freshMarkers + m6.staleMarkers}; stale cards: ${m6.staleCardCount})`);
  }
  if (result.baselineDiff && !result.baselineDiff.pass) process.exitCode = 1;
}

main();
