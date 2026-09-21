/**
 * Characterization pin — executor 未知会话终态快失败 + reconcile 清理残留内存绑定。
 *
 * 覆盖三层：
 *   1) 功能：waitForSessionEventWhere 谓词等待（非命中不 settle / 命中即 resolve / 超时 reject / 清理监听）。
 *   2) executor 侧接线：session.error 携带结构化 code，Unknown session → unknown_session。
 *   3) 控制面侧接线：attachLive/closeSession 只对 code='unknown_session' 快失败；
 *      reconcileRemoteSessions 对执行机不存在的 session 清 state.sessions / runtime / lease；
 *      轨迹锁默认等待 >= 45s attach 等待。
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  emitSessionEvent,
  getSessionHub,
  waitForSessionEventWhere,
} from '../../src/executor-event-hub.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
let failures = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); } else { failures += 1; console.error(`  ✗ ${msg}`); }
}
const read = (rel) => readFileSync(join(ROOT, ...rel.split('/')), 'utf8');

// ── 1. 功能：谓词等待语义 ──
{
  const sid = 'pin-session-where-1';
  const p = waitForSessionEventWhere(sid, 'session.error', (x) => x?.code === 'unknown_session', 1000);
  emitSessionEvent(sid, 'session.error', { code: 'transient' });
  emitSessionEvent(sid, 'session.error', { code: 'unknown_session', error: 'gone' });
  const resolved = await p;
  check(resolved?.code === 'unknown_session', 'matching payload resolves the wait');
  check(getSessionHub(sid).listenerCount('session.error') === 0, 'listener removed after resolve (no leak)');
}
{
  const sid = 'pin-session-where-2';
  let timedOut = false;
  try {
    await waitForSessionEventWhere(sid, 'session.error', (x) => x?.code === 'unknown_session', 60);
  } catch (err) {
    timedOut = /Timeout waiting for session\.error/.test(err?.message || '');
  }
  check(timedOut, 'non-matching only → rejects on timeout');
  check(getSessionHub(sid).listenerCount('session.error') === 0, 'listener removed after timeout (no leak)');
}
{
  const sid = 'pin-session-where-3';
  const p = waitForSessionEventWhere(sid, 'session.error', () => true, 5000);
  p.cancel();
  const settled = await Promise.race([
    p.then(() => 'resolved', () => 'rejected'),
    new Promise((r) => setTimeout(() => r('pending'), 30)),
  ]);
  check(settled === 'pending', 'cancel() drops the wait without resolving/rejecting');
  check(getSessionHub(sid).listenerCount('session.error') === 0, 'listener removed after cancel (no leak)');
}

// ── 2. executor 侧：结构化 code ──
{
  const agentSrc = read('executor/agent.mjs');
  check(agentSrc.includes('code: err?.code || \'session_error\''), 'agent.mjs sends session.error with structured code fallback');

  const mgrSrc = read('executor/session-manager.js');
  const unknownCount = (mgrSrc.match(/err\.code = 'unknown_session';/g) || []).length;
  check(unknownCount >= 2, 'session-manager marks both forward() and _attachBibLocked() Unknown session as unknown_session');
  check(mgrSrc.includes('Unknown session ${sessionId}'), 'Unknown session message text preserved');

  const handlerSrc = read('executor/session-handler.js');
  check(handlerSrc.includes("err.code = 'bad_request';"), 'session-handler marks missing sessionId as bad_request');
}

// ── 3. 控制面侧接线 ──
{
  const hubSrc = read('src/executor-event-hub.js');
  check(hubSrc.includes('export function waitForSessionEventWhere('), 'event hub exports waitForSessionEventWhere');
  check(hubSrc.includes('hub.on(type, onEvent)') && !/waitForSessionEventWhere[\s\S]*?hub\.once\(/.test(hubSrc), 'predicate wait keeps listening (no once)');

  const clientSrc = read('src/executor-session-client.js');
  check(clientSrc.includes('waitForSessionEventWhere'), 'executor-session-client imports/re-exports predicate wait');
  check(
    /waitForSessionEventWhere\([\s\S]*?'session\.error'[\s\S]*?'unknown_session'/.test(clientSrc),
    'closeSession races terminal unknown_session error',
  );

  const svcSrc = read('src/services/remote-session-service.js');
  check(
    svcSrc.includes('waitForSessionEventWhere')
      && svcSrc.includes('unknownP')
      && svcSrc.includes('Promise.race([readyP, errP, unknownP])'),
    'attachLive races a terminal unknown_session waiter',
  );
  check(svcSrc.includes("err.code = 'unknown_session'"), 'attachLive terminal failure carries code=unknown_session');

  const nodeSrc = read('src/services/executor-node-service.js');
  check(nodeSrc.includes('slotLease.releaseBySession(agentId)'), 'reconcile releases slot lease for executor-missing session');
  check(nodeSrc.includes('state.sessions.delete(agentId)'), 'reconcile drops stale control-plane session');
  check(nodeSrc.includes('getAllTrajectoryRuntimes().delete(tid)'), 'reconcile drops stale trajectory runtime');

  const cfgSrc = read('config/config.js');
  check(/TRAJ_LOCK_WAIT_TIMEOUT_MS[\s\S]{0,80}_resolve\('TRAJ_LOCK_WAIT_TIMEOUT_MS', '60000'\)/.test(cfgSrc), 'traj lock wait default raised to 60000ms (>= 45s attach wait)');
}

if (failures) { console.error(`FAIL: ${failures} assertion(s) failed`); process.exit(1); }
console.log('characterize-executor-unknown-session: OK');
