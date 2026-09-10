/**
 * KB coverage retrospective — Task 0: read-only DB snapshot → redacted fixture.
 *
 * Hard constraints (spec 2026-09-11-kb-coverage-retrospective-design §3):
 *  - DB is SELECT-only (no writes, no DDL);
 *  - fixture keys ⊆ the whitelist below; free text > 40 chars is dropped;
 *  - NEVER exported: task/name free text, URL query business values,
 *    element_json.text/attributes, params_json.value, extracted_content,
 *    error, done_logs, customer names / ID numbers.
 *  - NO recall/eval imports, no matcher runs (pure structural snapshot).
 *
 * Whitelisted shape (spec §3):
 *  trajectories[]: id, functionId, recordStatus, isSuccessful, pageId,
 *                  phaseCount, stepCount, createdDate (day precision),
 *                  urlCodes {fcnScnEcd, part} (codes only, queries dropped)
 *  steps aggregated per trajectory: visitedRegions [{key,label}] (deduped,
 *                  order-preserving, truncated) + actionCounts {type: n}
 *  pages[]: pageId, pageName, resPath
 *
 * Run: node scripts/kb/coverage-snapshot.mjs [--out path]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);

/** Load config/.env into process.env (non-destructive). */
function loadEnv() {
  const text = readFileSync(resolve(ROOT, 'config/.env'), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const MAX_TEXT = 40;
const MAX_VISITED = 200;

/** Redact any string: drop values longer than MAX_TEXT (structural keys are short by design). */
function redactString(value) {
  return typeof value === 'string' && value.length > MAX_TEXT ? null : value;
}

/** Extract only whitelisted codes from a trajectory URL (drop query business values). */
function extractUrlCodes(rawUrl) {
  if (!rawUrl) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const codes = {};
  const fcn = parsed.searchParams.get('fcnScnEcd');
  if (fcn && fcn.length <= MAX_TEXT) codes.fcnScnEcd = fcn;
  const part = parsed.searchParams.get('part');
  if (part && part.length <= MAX_TEXT) codes.part = part;
  // hash-route path segments may carry an FS code (e.g. /FS00005518Host...)
  const hashPath = parsed.hash || '';
  const fsMatch = hashPath.match(/FS\d{8,12}/);
  if (fsMatch) codes.fsFromPath = fsMatch[0];
  return Object.keys(codes).length > 0 ? codes : null;
}

/**
 * Pull one structural field from element_json wherever it lives (top or nested),
 * skipping anything under text/attributes-bearing branches. Returns first hit.
 */
function extractStructural(elementJson, key) {
  if (elementJson === null || elementJson === undefined) return null;
  const walk = (node, depth) => {
    if (node === null || typeof node !== 'object' || depth > 4) return null;
    for (const [k, v] of Object.entries(node)) {
      if (k === key && (typeof v === 'string' || typeof v === 'number')) {
        const s = String(v);
        if (s.length > 0 && s.length <= MAX_TEXT) return s;
        return null;
      }
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        const hit = walk(v, depth + 1);
        if (hit !== null) return hit;
      }
    }
    return null;
  };
  return walk(elementJson, 0);
}

async function main() {
  loadEnv();
  // Tunnel override (read-only snapshot path): the tunnel is 127.0.0.1:13306;
  // config/.env keeps the production direct address (firewalled by design).
  // Env vars win over .env without touching the shared file.
  process.env.DB_HOST = process.env.SNAPSHOT_DB_HOST || '127.0.0.1';
  process.env.DB_PORT = process.env.SNAPSHOT_DB_PORT || '13306';
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    connectTimeout: 10000,
  });

  // --- trajectories (whitelisted columns only) ---
  const [trajRows] = await conn.query(`
    SELECT id, function_id, record_status, is_successful, page_id,
           phase_count, step_count, url, created_at
    FROM trajectory`);
  const trajectories = trajRows.map((r) => ({
    id: String(r.id),
    functionId: r.function_id === null ? null : String(r.function_id),
    recordStatus: r.record_status,
    isSuccessful: r.is_successful === 1,
    pageId: r.page_id || null,
    phaseCount: r.phase_count,
    stepCount: r.step_count,
    createdDate: r.created_at ? String(r.created_at).slice(0, 10) : null,
    urlCodes: extractUrlCodes(r.url),
  }));

  // --- steps aggregated per trajectory: visitedRegions + actionCounts ---
  const [stepRows] = await conn.query(`
    SELECT trajectory_id, action_type, element_json
    FROM trajectory_step
    ORDER BY trajectory_id ASC, step_number ASC, action_index ASC`);
  /** @type {Map<string, {visitedRegions: Array<{key: string|null, label: string|null}>, actionCounts: Record<string, number>}>} */
  const byTraj = new Map();
  for (const r of stepRows) {
    const tid = String(r.trajectory_id);
    let agg = byTraj.get(tid);
    if (!agg) {
      agg = { visitedRegions: [], actionCounts: {} };
      byTraj.set(tid, agg);
    }
    agg.actionCounts[r.action_type] = (agg.actionCounts[r.action_type] || 0) + 1;
    if (r.element_json) {
      let ej = r.element_json;
      if (typeof ej === 'string') {
        try { ej = JSON.parse(ej); } catch { ej = null; }
      }
      const label = extractStructural(ej, 'region_label');
      const key = extractStructural(ej, 'page_level_key');
      if (label !== null || key !== null) {
        const sig = `${key || ''}|${label || ''}`;
        const last = agg.visitedRegions[agg.visitedRegions.length - 1];
        const lastSig = last ? `${last.key || ''}|${last.label || ''}` : '';
        if (sig !== lastSig && agg.visitedRegions.length < MAX_VISITED) {
          agg.visitedRegions.push({ key: key || null, label: label || null });
        }
      }
    }
  }
  for (const t of trajectories) {
    const agg = byTraj.get(t.id);
    t.visitedRegions = agg ? agg.visitedRegions : [];
    t.actionCounts = agg ? agg.actionCounts : {};
  }

  // --- system_page (page-level chain) ---
  const [pageRows] = await conn.query(`
    SELECT page_id, page_name, res_path FROM system_page`);
  const pages = pageRows
    .map((r) => ({
      pageId: r.page_id || null,
      pageName: redactString(r.page_name),
      resPath: redactString(r.res_path),
    }))
    .filter((p) => p.pageId !== null);

  await conn.end();

  // --- provenance + self-checks ---
  const stepsTotal = [...byTraj.values()].reduce((n, a) => n + Object.values(a.actionCounts).reduce((x, y) => x + y, 0), 0);
  const body = {
    snapshotVersion: 'v1',
    changeLog: [
      'v1 (2026-09-11): initial snapshot per spec 2026-09-11-kb-coverage-retrospective-design §3',
    ],
    capturedAt: new Date().toISOString(),
    counts: {
      trajectories: trajectories.length,
      withPageId: trajectories.filter((t) => t.pageId).length,
      steps: stepsTotal,
      pages: pages.length,
    },
    redaction: {
      whitelistOnly: true,
      maxFreeText: MAX_TEXT,
      forbidden:
        'task/name free text, URL query business values, element_json.text/attributes, params_json.value, extracted_content, error, done_logs, customer PII',
    },
    trajectories,
    pages,
  };
  const contentSha = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const fixture = { ...body, contentSha256: contentSha };

  const outPath = process.argv.includes('--out')
    ? resolve(process.argv[process.argv.indexOf('--out') + 1])
    : resolve(ROOT, 'scripts/characterization/fixtures/kb-coverage.v1.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n');

  const sizeBytes = Buffer.byteLength(JSON.stringify(fixture, null, 2) + '\n');
  console.log(`fixture: ${outPath}`);
  console.log(`counts: ${JSON.stringify(fixture.counts)}`);
  console.log(`size: ${(sizeBytes / 1024).toFixed(1)} KB  sha256: ${contentSha.slice(0, 16)}…`);
  if (sizeBytes > 1024 * 1024) {
    console.error('FAIL: fixture exceeds 1 MB');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
