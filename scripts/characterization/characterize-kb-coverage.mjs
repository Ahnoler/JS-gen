/**
 * Characterization gate: KB coverage retrospective (spec
 * 2026-09-11-kb-coverage-retrospective-design; plan Task 2).
 *
 * Three assertion families:
 *  1. fixture shape — version keys, counts, page_id set non-empty;
 *  2. REDACTION (hard, falsifiable) — every key in the fixture's DATA AREA
 *     (trajectories[]/pages[] incl. nested) must be whitelisted; actionCounts
 *     subkeys must be action-type tokens (^[a-z_]+$); free text > 40 chars in
 *     the data area = FAIL; metadata strings (changeLog/redaction.forbidden/
 *     contentSha256) are exempt. Injecting a `task` field MUST turn this red.
 *  3. floors — M1/M2/M3/M5 (joinability/coverage/utilization/nodeCoverage/
 *     orderAgreement) from the frozen baseline minus fixed margin 0.05,
 *     only ever rise. Raising any floor by 0.2 MUST turn this red.
 *
 * Run:
 *   node scripts/characterization/characterize-kb-coverage.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { computeCoverage } from '../kb/kb-coverage.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
// KB_COVERAGE_FIXTURE lets falsification runs point at a tampered copy (tmp/ only).
const FIXTURE_PATH = process.env.KB_COVERAGE_FIXTURE
  ? new URL(`file://${process.env.KB_COVERAGE_FIXTURE.replace(/\\/g, '/')}`)
  : new URL('./fixtures/kb-coverage.v1.json', import.meta.url);
const BASELINE_PATH = process.env.KB_COVERAGE_BASELINE
  ? new URL(`file://${process.env.KB_COVERAGE_BASELINE.replace(/\\/g, '/')}`)
  : new URL('./fixtures/kb-coverage-baseline.v1.json', import.meta.url);
const MARGIN = 0.05;

let passed = 0;

/**
 * Register one assertion block.
 * @param {string} name Assertion name
 * @param {() => void} fn Assertion body
 * @returns {void}
 */
function run(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n${e && e.message ? e.message : e}`);
    throw e;
  }
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

run('fixture shape: version keys, counts, page_id intersection', () => {
  assert.equal(fixture.snapshotVersion, 'v1');
  assert.ok(typeof fixture.capturedAt === 'string' && fixture.capturedAt.length > 0, 'capturedAt required');
  assert.ok(typeof fixture.contentSha256 === 'string' && fixture.contentSha256.length === 64, 'contentSha256 required');
  const c = fixture.counts;
  assert.ok(c.trajectories > 0 && c.pages > 0 && c.steps > 0, 'counts must be positive');
  const trajPageIds = new Set(fixture.trajectories.map((t) => t.pageId).filter(Boolean));
  const pageIds = new Set(fixture.pages.map((p) => p.pageId));
  const inter = [...trajPageIds].filter((x) => pageIds.has(x));
  assert.ok(inter.length > 0, `trajectory page_ids must intersect system_page (got ${inter.length})`);
  assert.ok(Array.isArray(fixture.trajectories) && fixture.trajectories.length === c.trajectories, 'trajectories array matches counts');
});

run('redaction: data-area keys ⊆ whitelist, actionCounts subkeys are action tokens, no long free text', () => {
  const TOP_KEYS = new Set([
    'snapshotVersion', 'changeLog', 'capturedAt', 'counts', 'redaction',
    'trajectories', 'pages', 'contentSha256',
  ]);
  const META_KEYS = new Set(['changeLog', 'redaction', 'contentSha256']);
  const TRAJ_KEYS = new Set([
    'id', 'functionId', 'recordStatus', 'isSuccessful', 'pageId', 'phaseCount',
    'stepCount', 'createdDate', 'urlCodes', 'visitedRegions', 'actionCounts',
  ]);
  const REGION_KEYS = new Set(['key', 'label']);
  const URL_CODE_KEYS = new Set(['fcnScnEcd', 'part', 'fsFromPath']);
  const PAGE_KEYS = new Set(['pageId', 'pageName', 'resPath']);
  const badKeys = [];
  const longTexts = [];
  const isActionToken = (k) => /^[a-z_]+$/.test(k);

  for (const [k, v] of Object.entries(fixture)) {
    if (!TOP_KEYS.has(k)) badKeys.push(`top.${k}`);
    if (k === 'trajectories') {
      for (const t of v) {
        for (const [tk, tv] of Object.entries(t)) {
          if (!TRAJ_KEYS.has(tk)) badKeys.push(`traj.${tk}`);
          if (typeof tv === 'string' && tv.length > 40) longTexts.push(`traj.${tk}(${tv.length})`);
          if (tk === 'visitedRegions' && Array.isArray(tv)) {
            for (const r of tv) {
              for (const [rk, rv] of Object.entries(r)) {
                if (!REGION_KEYS.has(rk)) badKeys.push(`region.${rk}`);
                if (typeof rv === 'string' && rv.length > 40) longTexts.push(`region.${rk}(${rv.length})`);
              }
            }
          }
          if (tk === 'actionCounts' && tv && typeof tv === 'object') {
            for (const [ak, av] of Object.entries(tv)) {
              if (!isActionToken(ak)) badKeys.push(`actionCounts.${ak}`);
              if (typeof av !== 'number') badKeys.push(`actionCounts.value.${ak}`);
            }
          }
          if (tk === 'urlCodes' && tv && typeof tv === 'object') {
            for (const uk of Object.keys(tv)) {
              if (!URL_CODE_KEYS.has(uk)) badKeys.push(`urlCodes.${uk}`);
            }
          }
        }
      }
    }
    if (k === 'pages') {
      for (const p of v) {
        for (const [pk, pv] of Object.entries(p)) {
          if (!PAGE_KEYS.has(pk)) badKeys.push(`page.${pk}`);
          if (typeof pv === 'string' && pv.length > 40) longTexts.push(`page.${pk}(${pv.length})`);
        }
      }
    }
  }
  assert.deepEqual(badKeys, [], `non-whitelisted data-area keys: ${[...new Set(badKeys)].join(', ')}`);
  assert.deepEqual(longTexts, [], `free text >40 chars in data area: ${longTexts.slice(0, 3).join('; ')}`);
});

run('floors hold: M1/M2/M3/M5 vs frozen baseline (margin 0.05, only rise)', () => {
  const result = computeCoverage(fixture);
  const FLOORS = ['m1.joinability', 'm2.coverage', 'm3.utilization', 'm5.nodeCoverage', 'm5.orderAgreement'];
  for (const path of FLOORS) {
    const cur = path.split('.').reduce((o, k) => o[k], result.metrics);
    const base = path.split('.').reduce((o, k) => o[k], baseline.metrics);
    if (cur === null || base === null) continue; // M5 null only when no mapped regions exist
    const floor = +(base - MARGIN).toFixed(3);
    assert.ok(cur >= floor, `${path} ${cur} < floor ${floor} (baseline ${base} - ${MARGIN})`);
    console.log(`    OK ${path}: current=${cur} floor=${floor}`);
  }
});

console.log(`\ncharacterize-kb-coverage: ${passed} passed`);
