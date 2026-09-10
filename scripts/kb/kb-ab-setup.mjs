/**
 * KB value A/B (direction 2) — Task 1: assemble paired A/B trajectories.
 *
 * Reads the frozen manifest (scripts/kb/kb-ab-manifest.v1.json), creates one
 * trajectory per (requirement, arm) via the product API
 * (POST /api/v2/trajectories with phases), and for the B arm prepends the
 * 【流程卡模板】hint block (built by the SAME builder the prepare path uses,
 * src/services/req-draft-traj/flow-card-recall.js buildFlowTemplateHint) to
 * the first phase description.
 *
 * Purity contract (plan Task 1 DoD):
 *   arm marker goes ONLY into trajectory name: KBAB<runId>-<arm>-<reqId>;
 *   A.description === B.description with the hint block removed — byte-exact.
 * This script verifies that AFTER creation by fetching both trajectories back
 * and comparing; on any mismatch it exits non-zero and records the run as
 * setup-invalid.
 *
 * Modes:
 *   --dry-run   print the payloads (name/description diff) without POSTing
 *   --pair R02  assemble one requirement pair (default: all requirements)
 *   --runId X   override runId (default: timestamp YYMMDDHHmm)
 *
 * No src/** changes; product API only. Serial by construction (caller runs
 * one pair at a time).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);

const FLOW_TEMPLATE_MARKER = '【流程卡模板】';
const FLOW_TEMPLATE_END_MARKER = '【/流程卡模板】';
const MAX_PRECONDITIONS = 12;

/** Load config/.env non-destructively (control plane port only). */
function loadEnv() {
  const p = resolve(ROOT, 'config/.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

/**
 * Mirror of buildFlowTemplateHint (flow-card-recall.js) — the prepare-time
 * builder takes card + atomTask; here the requirement text plays atomTask.
 * Byte-shape identical: marker line, menu, preconditions, atom task, end.
 * @param {object} card Flow card
 * @param {string} task Requirement/task text
 * @returns {string} Hint block
 */
function buildHintBlock(card, task) {
  const lines = [
    `${FLOW_TEMPLATE_MARKER}${card.flow}`,
    `菜单：${card.menu_path == null ? '' : String(card.menu_path)}`,
    '前置条件：',
  ];
  for (const item of (card.preconditions || []).slice(0, MAX_PRECONDITIONS)) {
    lines.push(`- ${item}`);
  }
  lines.push('【本原子任务】');
  lines.push(String(task || '').trim());
  lines.push(FLOW_TEMPLATE_END_MARKER);
  return lines.join('\n');
}

/**
 * Remove a hint block from a description (inverse of prepend).
 * @param {string} description Full B-arm description
 * @returns {string} Description without the hint block
 */
function stripHintBlock(description) {
  const s = String(description || '');
  const start = s.indexOf(FLOW_TEMPLATE_MARKER);
  const end = s.indexOf(FLOW_TEMPLATE_END_MARKER);
  if (start !== 0 || end < 0) return s;
  let rest = s.slice(end + FLOW_TEMPLATE_END_MARKER.length);
  if (rest.startsWith('\n')) rest = rest.slice(1);
  return rest;
}

/**
 * Fetch one trajectory with phases from the control plane.
 * @param {string} base Control-plane base URL
 * @param {number} id Trajectory id
 * @returns {Promise<object>} Trajectory with phases (response envelope stripped)
 */
async function getTrajectory(base, id) {
  const res = await fetch(`${base}/api/v2/trajectories/${id}/tree`).catch(() => null);
  if (res && res.ok) {
    const j = await res.json();
    return j.data ?? j;
  }
  const res2 = await fetch(`${base}/api/v2/trajectories/${id}`);
  if (!res2.ok) throw new Error(`GET trajectory ${id} failed: ${res2.status}`);
  const j2 = await res2.json();
  return j2.data ?? j2;
}

/**
 * POST one trajectory (with one phase) to the product API.
 * @param {string} base Control-plane base
 * @param {{name: string, functionId: number, description: string, systemAccountId: number}} spec Run spec
 * @returns {Promise<object>} Created trajectory row
 */
async function postTrajectory(base, spec) {
  const res = await fetch(`${base}/api/v2/trajectories`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      functionId: spec.functionId,
      name: spec.name,
      task: spec.description,
      phases: [{ description: spec.description }],
      systemAccountId: spec.systemAccountId,
    }),
  });
  if (!res.ok) throw new Error(`POST /api/v2/trajectories failed: ${res.status} ${await res.text().slice(0, 200)}`);
  return res.json();
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const manifestPath = get('--manifest', resolve(ROOT, 'scripts/kb/kb-ab-manifest.v1.json'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const base = `http://127.0.0.1:${process.env.PORT || 4097}`;
  const runId = get('--runId', new Date().toISOString().slice(2, 14).replace(/[-T:]/g, '').slice(0, 10));
  const onlyReq = args.includes('--pair') ? get('--pair', '') : null;
  const sysAcc = manifest.environment.systemAccountId;

  const reqs = manifest.requirements.filter((r) => !onlyReq || r.reqId === onlyReq);
  if (onlyReq && reqs.length === 0) throw new Error(`--pair ${onlyReq}: no such reqId in manifest`);

  const flowsDir = resolve(ROOT, 'data/kb/flows');
  const results = [];
  for (const r of reqs) {
    const card = JSON.parse(readFileSync(resolve(flowsDir, `${r.card}.json`), 'utf8'));
    // functionId: card menu_path carries the leaf binding (functionId=N); the
    // manifest carries the verified menu functionIds for this experiment.
    const functionId = r.functionId;
    if (!Number.isFinite(+functionId) || +functionId <= 0) throw new Error(`${r.reqId}: manifest missing functionId`);
    const description = r.requirement; // A-arm phase description = requirement text, verbatim
    const hint = buildHintBlock(card, r.requirement);
    const bDescription = `${hint}\n${description}`;
    const armOrder = r.armOrder || (manifest.officialPlan.order && null);
    const first = armOrder || (/^R\d\d+$/.test(r.reqId) && parseInt(r.reqId.slice(1), 10) % 2 === 1 ? 'A' : 'B');
    const pair = {
      reqId: r.reqId,
      armOrder: `${first}->${first === 'A' ? 'B' : 'A'}`,
      runs: {},
    };
    for (const arm of ['A', 'B']) {
      const spec = {
        name: `KBAB${runId}-${arm}-${r.reqId}`,
        functionId: +functionId,
        systemAccountId: sysAcc,
        description: arm === 'A' ? description : bDescription,
      };
      if (dryRun) {
        pair.runs[arm] = { dryRun: true, name: spec.name, descriptionPreview: spec.description.slice(0, 120) };
        continue;
      }
      const created = await postTrajectory(base, spec);
      const body = created && created.data ? created.data : created;
      const tid = body.id || (body.trajectory && body.trajectory.id);
      if (!tid) throw new Error(`${r.reqId}/${arm}: no trajectory id in response ${JSON.stringify(created).slice(0, 200)}`);
      pair.runs[arm] = { name: spec.name, trajectoryId: tid };
    }
    if (!dryRun) {
      // purity check: fetch both back, compare descriptions byte-exact
      const a = pair.runs.A.trajectoryId;
      const b = pair.runs.B.trajectoryId;
      const ta = await getTrajectory(base, a);
      const tb = await getTrajectory(base, b);
      const descOf = (t) => {
        const phases = t.phases || t.tree?.phases || [];
        const sorted = phases.slice().sort((x, y) => (x.phaseNumber ?? 0) - (y.phaseNumber ?? 0));
        return sorted[0]?.description ?? '';
      };
      const da = descOf(ta);
      const db = descOf(tb);
      if (!da || !db) {
        pair.purity = { ok: false, error: `empty description fetched: A len=${da.length} B len=${db.length} (endpoint shape mismatch)` };
        console.error(`PURITY FAIL ${r.reqId}: ${JSON.stringify(pair.purity)}`);
        results.push(pair);
        break;
      }
      const stripped = stripHintBlock(db);
      pair.purity = {
        aDescription: da,
        bContainsHint: db.includes(FLOW_TEMPLATE_MARKER),
        aContainsHint: da.includes(FLOW_TEMPLATE_MARKER),
        stripEqual: stripped === da,
      };
      if (!pair.purity.bContainsHint || pair.purity.aContainsHint || !pair.purity.stripEqual) {
        pair.purity.ok = false;
        console.error(`PURITY FAIL ${r.reqId}: ${JSON.stringify(pair.purity).slice(0, 300)}`);
        results.push(pair);
        break; // stop the batch; operator must clean up before continuing
      }
      pair.purity.ok = true;
    }
    results.push(pair);
    console.log(`${dryRun ? '[dry]' : 'OK'} ${r.reqId} order=${pair.armOrder} A=${pair.runs.A.trajectoryId || 'dry'} B=${pair.runs.B.trajectoryId || 'dry'}${pair.purity ? ` purity=${pair.purity.ok}` : ''}`);
  }

  mkdirSync(resolve(ROOT, 'tmp/kb-ab'), { recursive: true });
  const out = resolve(ROOT, 'tmp/kb-ab', dryRun ? `setup-dry-${runId}.json` : `setup-${runId}.json`);
  writeFileSync(out, JSON.stringify({ runId, manifest: manifestPath, pairs: results }, null, 2) + '\n');
  console.log(`written ${out}`);
  if (results.some((p) => p.purity && p.purity.ok === false)) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
