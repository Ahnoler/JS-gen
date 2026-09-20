import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { selectOrphanSessions } from '../../src/services/executor-orphan-session-service.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
let failures = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); } else { failures += 1; console.error(`  ✗ ${msg}`); }
}

// functional: selectOrphanSessions
check(selectOrphanSessions([{ sessionId: 'a', ready: true }, { sessionId: 'b', ready: true }], ['b']).map((s) => s.sessionId).join(',') === 'a', 'known session excluded, other selected');
check(selectOrphanSessions([{ sessionId: 'a' }, { sessionId: 'b' }], new Set(['a', 'b'])).length === 0, 'all known → no orphans');
check(selectOrphanSessions([{ sessionId: 'x', ready: false }], []).length === 0, 'in-flight open (ready=false) never closed');
check(selectOrphanSessions([{ sessionId: 'a' }, { sessionId: null }, {}], ['a']).length === 0, 'null/empty sessionId skipped');
check(selectOrphanSessions('not-an-array', []).length === 0, 'non-array input tolerated');

// source pins
const wsSrc = readFileSync(join(ROOT, 'src', 'executor-ws.js'), 'utf-8');
check(wsSrc.includes("reconcileOrphanSessions(") && wsSrc.includes("orphan executor session(s)"), 'executor-ws.js calls reconcileOrphanSessions in handleRegister');
const nodeSvcSrc = readFileSync(join(ROOT, 'src', 'services', 'executor-node-service.js'), 'utf8');
check(nodeSvcSrc.includes('reconcileRemoteSessions') && nodeSvcSrc.includes('listExecutorSessions'), 'executor node reconciliation uses executor session.list truth');
check(nodeSvcSrc.includes('remoteSessionDao.close(row.id, { crashed: true })'), 'only missing executor sessions are crashed');
check(nodeSvcSrc.includes('slotLease.confirmLease') && nodeSvcSrc.includes('registerTrajectorySession'), 'matched sessions restore runtime and slot lease');
check(nodeSvcSrc.includes("sendToExecutor(node.nodeUuid, 'session.attach_bib'"), 'active matched sessions request idempotent BiB reattach');
check(wsSrc.includes('reconcileRemoteSessions(node)'), 'executor registration performs remote session reconciliation');
// Node offline / executor restart: recording trajectories bound to the node must be
// marked failed(interrupted), not left stuck in recording.
check(nodeSvcSrc.includes('import { markRecordingInterrupted }'), 'executor node service imports markRecordingInterrupted');
check(nodeSvcSrc.includes('async function markNodeRecordingsInterrupted('), 'executor node service defines markNodeRecordingsInterrupted');
check(nodeSvcSrc.includes('getAllTrajectoryRuntimes()'), 'node interruption marking also reads in-memory runtimes');
{
  const calls = (nodeSvcSrc.match(/await markNodeRecordingsInterrupted\(/g) || []).length;
  check(calls >= 3, 'markNodeRecordingsInterrupted invoked on markOfflineAndCrash / sweepStale / unregister (>=3)');
}
const serverSrc = readFileSync(join(ROOT, 'server.mjs'), 'utf8');
check(!serverSrc.includes('crashOccupiedOnOfflineNodes()'), 'server boot does not bulk-crash sessions from offline node status');
const svcSrc = readFileSync(join(ROOT, 'src', 'services', 'executor-orphan-session-service.js'), 'utf-8');
check(svcSrc.includes('keepBrowser: true'), 'orphan close keeps browser (keepBrowser: true)');
check(svcSrc.includes('s.ready === true'), 'ready guard protects in-flight session.open');
check(svcSrc.includes("listByNode(node.id, ['active', 'idle'])"), 'known set built from active|idle rows');
const routeSrc = readFileSync(join(ROOT, 'src', 'routes', 'v2', 'executor.js'), 'utf-8');
check(routeSrc.includes('/api/v2/executors/:nodeUuid/sessions/:sessionId/close'), 'executor route exposes orphan session close');
const monSrc = readFileSync(join(ROOT, 'src', 'dashboard', 'api-docs', 'slot-monitor.js'), 'utf-8');
check(monSrc.includes('data-act="orphan-close"') && monSrc.includes('closeOrphanSession'), 'slot monitor renders orphan close button');

if (failures) { console.error(`FAIL: ${failures} assertion(s) failed`); process.exit(1); }
console.log('characterize-executor-orphan-reconcile: OK');
