/**
 * Acceptance smoke: multi-trajectory BiB lifecycle isolation.
 *
 * Checks schema + HTTP contracts for:
 *   - remote_session idle / agent_session_id / trajectory_id
 *   - POST /trajectories/:id/stream/detach (idempotent, scoped)
 *   - GET /remote-sessions/live/status?trajectoryId=
 *   - stream/detach vs detach semantics on draft trajs
 *
 * Full crosstalk (two prepare + release one keeps the other) needs a live executor;
 * this script validates the control-plane contract without requiring Chrome.
 *
 * Usage: node scripts/accept-multi-traj-lifecycle.mjs [baseUrl]
 * Default baseUrl: http://127.0.0.1:4097
 */
const BASE = (process.argv[2] || 'http://127.0.0.1:4097').replace(/\/$/, '');

const results = [];

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function req(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let raw;
  try { raw = JSON.parse(text); } catch { raw = { raw: text }; }
  const json = (raw && typeof raw === 'object' && 'code' in raw && 'data' in raw)
    ? raw.data
    : raw;
  return { status: res.status, json, envelope: raw };
}

async function main() {
  console.log(`\n=== Multi-traj lifecycle acceptance @ ${BASE} ===\n`);

  // ── Schema ──
  console.log('[schema] remote_session bindings');
  const { getDB, closeDB } = await import('../config/database.js');
  const db = getDB();
  try {
    const cols = await db.raw(
      `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'remote_session'
         AND COLUMN_NAME IN ('status','agent_session_id','trajectory_id')`,
    );
    const list = cols[0] || cols.rows || cols;
    const byName = Object.fromEntries((list || []).map((r) => [r.COLUMN_NAME || r.column_name, r]));
    if (byName.agent_session_id && byName.trajectory_id) {
      pass('columns agent_session_id + trajectory_id');
    } else {
      fail('binding columns', 'run: npx knex migrate:latest --knexfile config/knexfile.js');
    }
    const st = String(byName.status?.COLUMN_TYPE || byName.status?.column_type || '');
    if (st.includes('idle')) pass('status ENUM includes idle', st);
    else fail('status ENUM idle', st || 'missing');
  } catch (err) {
    fail('schema probe', err.message);
  }

  // ── Create two trajs ──
  console.log('\n[API] two trajectories');
  const ids = [];
  for (const i of [1, 2]) {
    const create = await req('POST', '/api/v2/trajectories', {
      name: `multi-traj-lifecycle-${i}-${Date.now()}`,
      requirement: 'lifecycle smoke',
      phases: ['阶段A'],
    });
    if (create.status === 201 && create.json?.id) {
      ids.push(create.json.id);
      pass(`POST traj #${i}`, `id=${create.json.id}`);
    } else {
      fail(`POST traj #${i}`, `status=${create.status}`);
    }
  }

  if (ids.length < 2) {
    console.log('\nAbort: need 2 trajectories');
    await closeDB().catch(() => {});
    process.exit(1);
  }

  const [t1, t2] = ids;

  // Idempotent stream detach on draft (no live browser)
  console.log('\n[API] stream/detach idempotent');
  for (const tid of [t1, t2]) {
    const det = await req('POST', `/api/v2/trajectories/${tid}/stream/detach`, {});
    if (det.status === 200 && det.json?.streamDetached === true && det.json?.sessionKept === true) {
      pass(`stream/detach traj #${tid}`, `recordStatus=${det.json.recordStatus}`);
    } else if (det.status === 200) {
      pass(`stream/detach traj #${tid} (200)`, JSON.stringify(det.json).slice(0, 120));
    } else {
      fail(`stream/detach traj #${tid}`, `status=${det.status} ${JSON.stringify(det.json)}`);
    }
  }

  // Scoped live/status
  console.log('\n[API] live/status scoped');
  for (const tid of [t1, t2]) {
    const st = await req('GET', `/api/v2/remote-sessions/live/status?trajectoryId=${tid}`);
    if (st.status === 200 && st.json?.attached === false) {
      pass(`live/status?trajectoryId=${tid}`, 'attached=false');
    } else {
      fail(`live/status?trajectoryId=${tid}`, `status=${st.status} ${JSON.stringify(st.json)}`);
    }
  }

  // Release one must not 500 the other
  console.log('\n[API] detach scoped (no crosstalk errors)');
  const release1 = await req('POST', `/api/v2/trajectories/${t1}/detach`, {});
  if (release1.status === 200 && release1.json?.detached) {
    pass(`detach traj #${t1}`);
  } else {
    fail(`detach traj #${t1}`, `status=${release1.status}`);
  }

  const status2 = await req('GET', `/api/v2/remote-sessions/live/status?trajectoryId=${t2}`);
  if (status2.status === 200) {
    pass(`after detach#${t1}, status#${t2} still ok`, `attached=${status2.json?.attached}`);
  } else {
    fail(`status#${t2} after detach#${t1}`, `status=${status2.status}`);
  }

  const stream2 = await req('POST', `/api/v2/trajectories/${t2}/stream/detach`, {});
  if (stream2.status === 200) {
    pass(`stream/detach traj #${t2} after sibling release`);
  } else {
    fail(`stream/detach traj #${t2}`, `status=${stream2.status}`);
  }

  const release2 = await req('POST', `/api/v2/trajectories/${t2}/detach`, {});
  if (release2.status === 200 && release2.json?.detached) {
    pass(`detach traj #${t2}`);
  } else {
    fail(`detach traj #${t2}`, `status=${release2.status}`);
  }

  // In-process lock smoke (same process as this script imports services)
  console.log('\n[unit] withTrajectoryLock serializes');
  try {
    const { withTrajectoryLock } = await import('../src/services/remote-session-service.js');
    const order = [];
    await Promise.all([
      withTrajectoryLock(t1, async () => {
        order.push('a-start');
        await new Promise((r) => setTimeout(r, 40));
        order.push('a-end');
      }),
      withTrajectoryLock(t1, async () => {
        order.push('b-start');
        order.push('b-end');
      }),
    ]);
    const joined = order.join(',');
    if (joined === 'a-start,a-end,b-start,b-end' || joined === 'b-start,b-end,a-start,a-end') {
      pass('withTrajectoryLock same-traj serial', joined);
    } else {
      fail('withTrajectoryLock same-traj serial', joined);
    }
  } catch (err) {
    fail('withTrajectoryLock', err.message);
  }

  await closeDB().catch(() => {});

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===\n`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
