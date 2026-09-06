/**
 * Control-plane agent stderr log management: per-session log files under
 * `logs/agent-stderr/`, line prefix strip/filter, and live active-target listing.
 */
import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from 'fs';
import path from 'path';
import { resolve, PROJECT_DIR } from '../../config/config.js';
import { shortSid } from '../utils/stderr-prefix.js';
import * as remoteSessionDao from '../dao/remote-session-dao.js';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as executorNodeDao from '../dao/executor-node-dao.js';
import * as lease from '../executor-slot-lease.js';

export { shortSid };

const LINE_PREFIX_RE = /^\[slot:(\d+)\s+sid:([a-z0-9]+)\]/;

/**
 * Strip executor/session tags for human export; keep raw on disk for filtering.
 * @param {string} line raw stderr line, possibly tagged `[slot:N sid:xxx]` or `[session …]`
 * @returns {string} line with leading slot/session tags removed
 */
export function stripLinePrefix(line) {
  let s = String(line)
    .replace(/^\[slot:\d+\s+sid:[a-z0-9]+\]\s?/, '');
  // Historical / live: [session] … or [session navigate] …
  s = s.replace(/^\[session(?:\s+[^\]]*)?\]\s?/, '');
  return s;
}

/**
 * Strip prefixes from a list of stderr lines (null/undefined → []).
 * @param {string[]} [lines] raw tagged stderr lines
 * @returns {string[]} lines with slot/session tags removed
 */
export function stripLinePrefixes(lines) {
  return (lines || []).map(stripLinePrefix);
}

/**
 * Resolve (creating if needed) the agent stderr log directory.
 * @returns {string} absolute log dir path
 */
export function resolveLogDir() {
  const dir = resolve('AGENT_STDERR_LOG_DIR') || path.join(PROJECT_DIR, 'logs', 'agent-stderr');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Absolute path to the stderr log file for a given agent session.
 * @param {string} sessionId agent session id
 * @returns {string} absolute log file path
 */
export function logPathForSession(sessionId) {
  return path.join(resolveLogDir(), `${sessionId}.log`);
}

/**
 * Append stderr lines to a session's log file (no-op when empty).
 * @param {string} sessionId agent session id
 * @param {string[]} lines stderr lines to append
 * @returns {void}
 */
export function appendLines(sessionId, lines) {
  if (!sessionId || !lines?.length) return;
  const filePath = logPathForSession(sessionId);
  appendFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8');
}

/**
 * Delete the control-plane stderr file for one agent session.
 * Scope: only `logs/agent-stderr/{sessionId}.log` (not other sessions / slots).
 * @param {string} sessionId agent session id whose log file should be deleted
 * @returns {{ cleared: boolean, sessionId: string, path: string }} result of unlink (or not-found stub)
 */
export function clearSessionLog(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) {
    const err = new Error('sessionId required to clear stderr log');
    err.statusCode = 400;
    throw err;
  }
  const filePath = logPathForSession(id);
  if (!existsSync(filePath)) {
    return { cleared: false, sessionId: id, path: filePath };
  }
  unlinkSync(filePath);
  return { cleared: true, sessionId: id, path: filePath };
}

/**
 * Resolve sessionId from filter then clear that file.
 * Prefers explicit sessionId; else trajectoryId / sid via resolveSessionIdFromFilter.
 * @param {object} [filter] filter identifying a session
 * @param {string} [filter.sessionId] explicit agent session id
 * @param {number} [filter.trajectoryId] trajectory id to resolve via lease/remote_session
 * @param {string} [filter.sid] short sid prefix to match against log filenames
 * @returns {Promise<{ cleared: boolean, sessionId: string, path: string }>} result of clearing the resolved session log
 */
export async function clearLogForFilter(filter = {}) {
  let sessionId = filter.sessionId ? String(filter.sessionId) : null;
  if (!sessionId) {
    sessionId = await resolveSessionIdFromFilter(filter);
  }
  if (!sessionId) {
    const err = new Error('cannot resolve sessionId to clear (need sessionId or live trajectoryId/sid)');
    err.statusCode = 404;
    throw err;
  }
  return clearSessionLog(sessionId);
}

/**
 * Test whether a stderr line matches the slot/sid filter (no filter → matches untagged lines only).
 * @param {string} line raw stderr line
 * @param {{ slot?: number, sid?: string }} [filter] slot/sid to match against the line tag
 * @returns {boolean} true if the line's tag matches the filter (or line is untagged with empty filter)
 */
export function lineMatches(line, { slot, sid } = {}) {
  const m = String(line).match(LINE_PREFIX_RE);
  if (!m) {
    return slot == null && sid == null;
  }
  if (slot != null && Number(m[1]) !== Number(slot)) return false;
  if (sid != null && m[2] !== String(sid).toLowerCase()) return false;
  return true;
}

function listLogFilePaths() {
  const dir = resolveLogDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.log'))
    .map((name) => path.join(dir, name));
}

function readMatchingLines(filePath, filter) {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf-8');
  if (!content) return [];
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (i === lines.length - 1 && line === '') continue;
    if (lineMatches(line, filter)) out.push(line);
  }
  return out;
}

/**
 * Resolve an agent sessionId from filter: explicit sessionId → trajectoryId lease/remote_session → sid prefix match.
 * @param {object} [filter] filter identifying a session
 * @param {string} [filter.sessionId] explicit agent session id
 * @param {number} [filter.trajectoryId] trajectory id to resolve via lease/remote_session
 * @param {string} [filter.sid] short sid prefix to match against log filenames
 * @returns {Promise<string|null>} resolved sessionId, or null if none matches
 */
export async function resolveSessionIdFromFilter(filter = {}) {
  if (filter.sessionId) return String(filter.sessionId);
  if (filter.trajectoryId != null) {
    const tid = Number(filter.trajectoryId);
    const leased = lease.getByTrajectory(tid);
    if (leased?.sessionId) return leased.sessionId;
    const rs = await remoteSessionDao.listOccupiedByTrajectory(tid);
    const hit = rs.find((row) => row.agentSessionId);
    if (hit?.agentSessionId) return hit.agentSessionId;
    return null;
  }
  if (filter.sid) {
    const want = String(filter.sid).toLowerCase();
    for (const filePath of listLogFilePaths()) {
      const base = path.basename(filePath, '.log');
      if (shortSid(base) === want) return base;
    }
    return null;
  }
  return null;
}

/**
 * Read all matching stderr lines from disk (single session file when sessionId given, else all log files).
 * @param {{ slot?: number, sid?: string, sessionId?: string }} [filter] slot/sid/sessionId filter
 * @returns {string[]} matching raw (still-tagged) stderr lines
 */
export function filterLines(filter = {}) {
  const { slot, sid, sessionId } = filter;
  const active = { slot, sid };
  if (sessionId) {
    return readMatchingLines(logPathForSession(sessionId), active);
  }
  const result = [];
  for (const filePath of listLogFilePaths()) {
    result.push(...readMatchingLines(filePath, active));
  }
  return result;
}

/**
 * List log file paths that contain at least one matching line (or just the session file when sessionId given).
 * @param {{ slot?: number, sid?: string, sessionId?: string }} [filter] slot/sid/sessionId filter
 * @returns {string[]} absolute log file paths matching the filter
 */
export function listLogFilesMatching(filter = {}) {
  const { sessionId } = filter;
  if (sessionId) {
    const p = logPathForSession(sessionId);
    return existsSync(p) ? [p] : [];
  }
  return listLogFilePaths().filter((filePath) => readMatchingLines(filePath, filter).length > 0);
}

/**
 * Ask connected executors for per-slot CDP ports (session.list).
 * @returns {Promise<object>} `{ byNodeUuid, bySessionId }` port maps keyed by node uuid / session id
 */
async function fetchLiveSlotPorts() {
  const { listExecutorSessions } = await import('../executor-session-client.js');
  const { isConnected } = await import('../executor-registry.js');
  const byNodeUuid = new Map();
  const bySessionId = new Map();

  const nodes = await executorNodeDao.list();
  await Promise.all(nodes.map(async (node) => {
    const uuid = node?.nodeUuid;
    if (!uuid || !isConnected(uuid)) return;
    try {
      const sessions = await listExecutorSessions(uuid, 3000);
      const slots = (Array.isArray(sessions) ? sessions : []).map((s) => ({
        slotIndex: Number(s.slotIndex),
        sessionId: s.sessionId || null,
        cdpPort: s.cdpPort != null && Number.isFinite(Number(s.cdpPort)) ? Number(s.cdpPort) : null,
        ready: !!s.ready,
        busy: !!s.busy,
      })).filter((s) => Number.isFinite(s.slotIndex));
      byNodeUuid.set(uuid, slots);
      for (const s of slots) {
        if (s.sessionId && s.cdpPort != null) bySessionId.set(String(s.sessionId), s.cdpPort);
      }
    } catch {
      // Node slow/offline mid-refresh — omit ports rather than fail /active
    }
  }));

  return { byNodeUuid, bySessionId };
}

/**
 * List occupied remote sessions enriched with live slot CDP ports + stderr-log presence for the /active console.
 * @returns {Promise<{ rows: object[], slotPorts: object[] }>} active stderr targets with live CDP port map
 */
export async function listActiveStderrTargets() {
  const occupied = await remoteSessionDao.listOccupied();
  const { byNodeUuid, bySessionId } = await fetchLiveSlotPorts();
  const rows = [];
  for (const rs of occupied) {
    const sessionId = rs.agentSessionId || '';
    const slotLease = sessionId ? lease.getBySession(sessionId) : null;
    const trajectory = rs.trajectoryId ? await trajectoryDao.getById(rs.trajectoryId) : null;
    const node = rs.executorNodeId ? await executorNodeDao.getById(rs.executorNodeId) : null;
    const nodeUuid = node?.nodeUuid ?? slotLease?.nodeUuid ?? null;
    const slotIndex = rs.slotIndex ?? slotLease?.slotIndex ?? null;
    let cdpPort = sessionId ? (bySessionId.get(String(sessionId)) ?? null) : null;
    if (cdpPort == null && nodeUuid != null && slotIndex != null) {
      const hit = (byNodeUuid.get(nodeUuid) || [])
        .find((s) => Number(s.slotIndex) === Number(slotIndex));
      if (hit?.cdpPort != null) cdpPort = hit.cdpPort;
    }
    rows.push({
      slotIndex,
      sid: sessionId ? shortSid(sessionId) : null,
      sessionId: sessionId || null,
      trajectoryId: rs.trajectoryId ?? null,
      trajectoryName: trajectory?.name ?? null,
      recordStatus: trajectory?.recordStatus ?? null,
      remoteSessionId: rs.id,
      remoteStatus: rs.status,
      executorNodeId: rs.executorNodeId ?? null,
      executorNodeUuid: nodeUuid,
      cdpPort,
      hasStderrLog: sessionId ? existsSync(logPathForSession(sessionId)) : false,
    });
  }

  const slotPorts = [...byNodeUuid.entries()].map(([executorNodeUuid, slots]) => ({
    executorNodeUuid,
    slots,
  }));

  return { rows, slotPorts };
}
