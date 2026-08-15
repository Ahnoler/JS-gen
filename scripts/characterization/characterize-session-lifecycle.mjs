/**
 * Session lifecycle ownership rules (offline).
 * Run: node scripts/characterization/characterize-session-lifecycle.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  isWithinGrace,
  canClaimRemoteSession,
  graceOwnedError,
  computeGraceUntil,
} from '../../src/services/session-lifecycle-rules.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function testRules() {
  const now = Date.parse('2026-08-11T12:00:00.000Z');
  const graceUntil = new Date(now + 15 * 60 * 1000);

  assert.equal(
    isWithinGrace({ graceUntil, trajectoryId: 36 }, now),
    true,
    'inside grace',
  );
  assert.equal(
    isWithinGrace({ graceUntil, trajectoryId: 36 }, now + 16 * 60 * 1000),
    false,
    'past grace',
  );
  assert.equal(
    isWithinGrace({ graceUntil: null, trajectoryId: 36 }, now),
    false,
    'no grace_until → not within grace',
  );

  const ownedIdle = {
    id: 576,
    status: 'idle',
    trajectoryId: 129,
    graceUntil,
  };
  const denied = canClaimRemoteSession(ownedIdle, 112, now);
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'grace_owned');
  assert.equal(denied.ownerTrajectoryId, 129);

  const same = canClaimRemoteSession(ownedIdle, 129, now);
  assert.equal(same.ok, true, 'owner may reclaim during grace');

  const expired = canClaimRemoteSession(
    { ...ownedIdle, graceUntil: new Date(now - 1000) },
    112,
    now,
  );
  // Still has trajectoryId but grace expired → claim rules treat as not grace-blocked
  // (expiry clearer should null trajectory_id; rules allow claim if !isWithinGrace)
  assert.equal(expired.ok, true, 'expired grace claimable even if traj id stale');

  const unowned = { id: 1, status: 'idle', trajectoryId: null, graceUntil: null };
  assert.equal(canClaimRemoteSession(unowned, 112, now).ok, true);

  const err = graceOwnedError({ ownerTrajectoryId: 129, graceUntil, remoteSessionId: 576 });
  assert.equal(err.statusCode, 409);
  assert.equal(err.code, 'grace_owned');

  const until = computeGraceUntil(now, 900000);
  assert.equal(until.toISOString(), graceUntil.toISOString());
}

function testDaoContractSource() {
  const dao = readFileSync(join(root, 'src/dao/remote-session-dao.js'), 'utf8');
  // After Task 3: markIdle must NOT unconditionally null trajectory_id
  assert.match(
    dao,
    /graceUntil|grace_until/,
    'dao must know grace_until',
  );
  const markIdleBlock = dao.match(
    /export async function markIdle[\s\S]*?(?=export async function )/,
  )?.[0];
  assert.ok(markIdleBlock, 'markIdle must exist');
  assert.doesNotMatch(
    markIdleBlock,
    /trajectoryId:\s*null/,
    'markIdle must not clear trajectoryId (grace keeps ownership)',
  );
  assert.match(dao, /export async function clearGraceOwnership/);
  assert.match(dao, /export async function listGraceExpired/);
}

function testConfigExport() {
  const cfg = readFileSync(join(root, 'config/config.js'), 'utf8');
  assert.match(cfg, /REMOTE_SESSION_GRACE_MS/);
}

function testReaperWiresGrace() {
  const src = readFileSync(join(root, 'src/services/trajectory/trajectory-idle-reaper.js'), 'utf8');
  assert.match(src, /expireAllDueGrace/);
}

function testLifecycleSourceContracts() {
  const life = readFileSync(join(root, 'src/services/session-lifecycle.js'), 'utf8');
  const remote = readFileSync(join(root, 'src/services/remote-session-service.js'), 'utf8');
  assert.match(life, /export async function syncMount/);
  assert.match(life, /export async function streamDetachOwnership/);
  assert.match(life, /export async function expireAllDueGrace/);
  assert.match(life, /grace_owned|canClaimRemoteSession/);
  // detachLive must not call markIdle without going through lifecycle ownership
  assert.match(remote, /session-lifecycle|streamDetachOwnership/);
  assert.doesNotMatch(
    remote,
    /await remoteSessionDao\.markIdle\(/,
    'detachLive must not call remoteSessionDao.markIdle directly',
  );
}

function testAttachClaimGateSource() {
  const attach = readFileSync(
    join(root, 'src/services/trajectory/trajectory-attach-service.js'),
    'utf8',
  );
  const remote = readFileSync(join(root, 'src/services/remote-session-service.js'), 'utf8');
  assert.match(attach, /assertNoForeignGraceOnNodeSlot|assertClaimable/);
  assert.match(attach, /reusedChrome/);
  const graceGate = attach.match(
    /async function assertNoForeignGraceOnNodeSlot[\s\S]*?(?=\n(?:async )?function )/,
  )?.[0];
  assert.ok(graceGate, 'assertNoForeignGraceOnNodeSlot must exist');
  // reusedChrome must gate even when cdpPort is null (no early return on missing port)
  assert.doesNotMatch(
    graceGate,
    /reusedChrome[\s\S]*cdpPort\s*==\s*null[\s\S]*return/,
    'reusedChrome claim gate must not early-return solely because cdpPort is null',
  );
  assert.match(graceGate, /assertClaimable/);

  // Slot-aware: different non-null slotIndex rows skipped; same/unknown + grace idle gated
  const tieHelper = attach.match(
    /function rowTiedToReusedChrome[\s\S]*?(?=\n(?:async )?function )/,
  )?.[0];
  assert.ok(tieHelper, 'rowTiedToReusedChrome must exist');
  assert.match(
    tieHelper,
    /openedSlot\s*!==\s*rowSlot|rowSlot\s*!==\s*openedSlot/,
    'must skip rows with a different non-null slotIndex',
  );
  assert.match(tieHelper, /isWithinGrace|trajectoryId/, 'idle grace/owned rows must still gate');
  assert.match(
    attach,
    /rowTiedToReusedChrome[\s\S]*continue/,
    'gate loop must skip non-tied rows via continue',
  );

  // Hard detach resolves remote session via truth after streamDetach cleared cache
  assert.match(
    attach,
    /getByTrajectory|resolveHardDetachRemoteSessionId/,
    'hard detach must resolve remote_session via truth lookup',
  );
  assert.match(
    attach,
    /clearOwnershipOnClose/,
    'hard detach must clear ownership via lifecycle',
  );

  // idle reuse in attachLive must gate before markActive
  const idleReuse = remote.match(
    /Reuse idle remote row[\s\S]*?markActive/,
  )?.[0];
  assert.ok(idleReuse, 'attachLive idle reuse block must exist');
  assert.match(idleReuse, /assertClaimable/);
}

function testGraceClearedOnReclaim() {
  const dao = readFileSync(join(root, 'src/dao/remote-session-dao.js'), 'utf8');
  const life = readFileSync(join(root, 'src/services/session-lifecycle.js'), 'utf8');
  const markActive = dao.match(
    /export async function markActive[\s\S]*?(?=export async function )/,
  )?.[0];
  assert.ok(markActive, 'markActive must exist');
  assert.match(markActive, /graceUntil:\s*null/, 'markActive must clear grace_until on reclaim');
  const syncMount = life.match(
    /export async function syncMount[\s\S]*?(?=export async function )/,
  )?.[0];
  assert.ok(syncMount, 'syncMount must exist');
  assert.match(syncMount, /graceUntil:\s*null/, 'syncMount must clear grace_until on mount');
}

testRules();
testConfigExport();
testDaoContractSource();
testReaperWiresGrace();
testLifecycleSourceContracts();
testAttachClaimGateSource();
testGraceClearedOnReclaim();
console.log('characterize-session-lifecycle: rules + dao + lifecycle OK');
