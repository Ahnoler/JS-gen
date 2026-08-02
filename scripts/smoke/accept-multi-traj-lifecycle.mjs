/**
 * Acceptance smoke: multi-trajectory BiB lifecycle isolation.
 *
 * Checks schema + HTTP contracts for:
 *   - remote_session idle / agent_session_id / trajectory_id
 *   - POST /trajectories/:id/stream/detach (idempotent, scoped)
 *   - GET /remote-sessions/live/status?trajectoryId=
 *   - stream/detach vs detach semantics on draft trajs
 *   - resolveLiveBinding single-bind fallback / ambiguous reject
 *   - recording:stream_detached broadcast on stream/detach
 *
 * Full crosstalk (two prepare + release one keeps the other) needs a live executor;
 * this script validates the control-plane contract without requiring Chrome.
 *
 * Usage: node scripts/smoke/accept-multi-traj-lifecycle.mjs [baseUrl]
 * Default baseUrl: http://127.0.0.1:4097
 */
import WebSocket from 'ws';

const BASE = (process.argv[2] || 'http://127.0.0.1:4097').replace(/\/$/, '');
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws';

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

async function waitUntilWsOpen(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('ws open timeout'));
    }, timeoutMs);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
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

  // stream/detach broadcasts recording:stream_detached (distinct from recording:detached)
  console.log('\n[WS] recording:stream_detached broadcast');
  try {
    const ws = await waitUntilWsOpen(5000);
    const waitP = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for recording:stream_detached')), 8000);
      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(String(raw)); } catch { return; }
        if (msg?.type !== 'recording:stream_detached') return;
        if (Number(msg.payload?.trajectoryId) !== t2) return;
        clearTimeout(timer);
        resolve(msg.payload);
      });
    });
    const det = await req('POST', `/api/v2/trajectories/${t2}/stream/detach`, {});
    if (det.status !== 200) {
      fail('stream/detach for WS probe', `status=${det.status}`);
      try { ws.close(); } catch {}
    } else {
      const payload = await waitP;
      try { ws.close(); } catch {}
      if (payload && Number(payload.trajectoryId) === t2) {
        pass('recording:stream_detached broadcast', `trajectoryId=${payload.trajectoryId}`);
      } else {
        fail('recording:stream_detached broadcast', JSON.stringify(payload));
      }
    }
  } catch (err) {
    fail('recording:stream_detached broadcast', err.message);
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

  // In-process lock smoke + resolveLiveBinding fallback / ambiguous reject
  console.log('\n[unit] withTrajectoryLock + resolveLiveBinding');
  try {
    const rss = await import('../src/services/remote-session-service.js');
    const { withTrajectoryLock, clearExecutorLive, restoreLiveBindingFromRow, resolveLiveBinding } = rss;

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

    clearExecutorLive();
    const single = restoreLiveBindingFromRow({
      id: 90001,
      sessionUuid: 'uuid-single',
      trajectoryId: t1,
      agentSessionId: 'agent-single',
      executorNodeId: 1,
      viewportW: 1920,
      viewportH: 1080,
      status: 'active',
    }, { nodeUuid: 'node-a', attached: true });
    if (single?.attached) {
      const picked = resolveLiveBinding({});
      if (picked && picked.remoteSessionId === 90001) {
        pass('resolveLiveBinding single-bind fallback', `id=${picked.remoteSessionId}`);
      } else {
        fail('resolveLiveBinding single-bind fallback', JSON.stringify(picked));
      }
    } else {
      fail('restoreLiveBindingFromRow single', 'not attached');
    }

    restoreLiveBindingFromRow({
      id: 90002,
      sessionUuid: 'uuid-two',
      trajectoryId: t2,
      agentSessionId: 'agent-two',
      executorNodeId: 1,
      viewportW: 1920,
      viewportH: 1080,
      status: 'active',
    }, { nodeUuid: 'node-a', attached: true });

    const ambiguous = resolveLiveBinding({});
    if (ambiguous == null) {
      pass('resolveLiveBinding ambiguous (2+) rejects no-identity');
    } else {
      fail('resolveLiveBinding ambiguous reject', `got id=${ambiguous.remoteSessionId}`);
    }

    const byTid = resolveLiveBinding({ trajectoryId: t1 });
    if (byTid && byTid.remoteSessionId === 90001) {
      pass('resolveLiveBinding by trajectoryId', `id=${byTid.remoteSessionId}`);
    } else {
      fail('resolveLiveBinding by trajectoryId', JSON.stringify(byTid));
    }

    const miss = resolveLiveBinding({ trajectoryId: 999999001 });
    if (miss == null) {
      pass('resolveLiveBinding miss identity does not fall back');
    } else {
      fail('resolveLiveBinding miss identity', `got id=${miss.remoteSessionId}`);
    }

    clearExecutorLive();
  } catch (err) {
    fail('resolveLiveBinding unit', err.message);
  }

  // resolveBibTarget export smoke
  console.log('\n[unit] resolveBibTarget');
  try {
    const { resolveBibTarget } = await import('../src/cdp/remote-bridge.js');
    const rss = await import('../src/services/remote-session-service.js');
    rss.clearExecutorLive();
    rss.restoreLiveBindingFromRow({
      id: 90011,
      sessionUuid: 'uuid-bib',
      trajectoryId: t1,
      agentSessionId: 'agent-bib',
      executorNodeId: 1,
      viewportW: 1920,
      viewportH: 1080,
      status: 'active',
    }, { nodeUuid: 'node-bib', attached: true });

    const pick = resolveBibTarget({});
    if (pick && pick.sessionId === 'agent-bib' && pick.executorNodeUuid === 'node-bib') {
      pass('resolveBibTarget single-bind fallback', `sessionId=${pick.sessionId}`);
    } else {
      fail('resolveBibTarget single-bind fallback', JSON.stringify(pick));
    }

    rss.restoreLiveBindingFromRow({
      id: 90012,
      sessionUuid: 'uuid-bib-2',
      trajectoryId: t2,
      agentSessionId: 'agent-bib-2',
      executorNodeId: 1,
      viewportW: 1920,
      viewportH: 1080,
      status: 'active',
    }, { nodeUuid: 'node-bib', attached: true });

    const none = resolveBibTarget({});
    if (none == null) {
      pass('resolveBibTarget ambiguous rejects no-identity');
    } else {
      fail('resolveBibTarget ambiguous reject', JSON.stringify(none));
    }

    const scoped = resolveBibTarget({ trajectoryId: t2 });
    if (scoped && scoped.sessionId === 'agent-bib-2') {
      pass('resolveBibTarget by trajectoryId', `sessionId=${scoped.sessionId}`);
    } else {
      fail('resolveBibTarget by trajectoryId', JSON.stringify(scoped));
    }

    rss.clearExecutorLive();
  } catch (err) {
    fail('resolveBibTarget unit', err.message);
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
