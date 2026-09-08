/**
 * Commit propose-cache atoms to draft trajectories (analyze → create + provenance).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as systemDao from '../../dao/system-dao.js';
import { findDraftByReqAtomKey } from '../../dao/trajectory-dao.js';
import { AppError } from '../../http/app-error.js';
import { moduleDir } from '../kb-req-modules.js';
import {
  analyzeRequirementToPhases,
  createTransactionWithPhases,
} from '../trajectory/trajectory-meta-service.js';
import { assertAtomProvenance } from './provenance.js';
import { readProposeCache, PROPOSE_CACHE_VERSION } from './propose-cache.js';

/**
 * Load the propose cache and refuse stale shapes: missing cache → VALIDATION;
 * cacheVersion mismatch or through-chains.md hash drift → STALE_PROPOSE_CACHE
 * (the source changed since propose — re-run propose, never silently reuse).
 * @param {string} moduleKey KB req module key
 * @param {string|undefined} rootDir Module workspace root override
 * @returns {Promise<object>} Validated cache payload
 */
async function loadFreshProposeCache(moduleKey, rootDir) {
  const modDir = moduleDir(moduleKey, rootDir);
  const cache = await readProposeCache(modDir);
  if (!cache?.atoms?.length) {
    throw new AppError('propose cache missing — run draft-traj/propose first', { code: 'VALIDATION' });
  }
  if (cache.cacheVersion !== PROPOSE_CACHE_VERSION) {
    throw new AppError('propose cache outdated — run draft-traj/propose again', { code: 'STALE_PROPOSE_CACHE' });
  }
  let md;
  try {
    md = await readFile(join(modDir, 'through-chains.md'), 'utf-8');
  } catch {
    throw new AppError('through-chains.md missing — run draft-traj/propose again', { code: 'STALE_PROPOSE_CACHE' });
  }
  const hash = createHash('sha256').update(md, 'utf8').digest('hex');
  if (hash !== cache.sourceHash) {
    throw new AppError('through-chains changed — run draft-traj/propose again', { code: 'STALE_PROPOSE_CACHE' });
  }
  return cache;
}

/**
 * Check that a function id exists in the system table (FK guard before
 * trajectory create — hallucinated ids would be rejected by the FK anyway,
 * but with a cryptic create_failed error instead of a clean skip reason).
 * Fail-safe: when the lookup itself errors, warn and return true so a
 * validation outage never blocks commit.
 * @param {number|string} functionId Function id candidate (override or suggestion)
 * @param {((id: number) => Promise<boolean>)|null} [existsFn] Optional injected
 *   existence check (offline characterization stubs); defaults to systemDao.
 * @returns {Promise<boolean>} True when the id exists or the check failed open
 */
async function isKnownFunctionId(functionId, existsFn = null) {
  const exists = existsFn || ((id) => systemDao.getById(id));
  try {
    return Boolean(await exists(Number(functionId)));
  } catch (e) {
    console.warn('[req-draft-traj] functionId %s existence check failed (%s) — fail-open', functionId, e.message);
    return true;
  }
}

/**
 * Dry-run validation shared by commit and the validate endpoint: every check
 * that does not need analyze/create (cache lookup, provenance, any-state
 * duplicate, functionId presence/existence). No writes, no LLM.
 * @param {object} [opts] Validation options (same shape as commitDraftTrajectories minus analyze/create)
 * @param {string} opts.moduleKey KB req module key
 * @param {string[]} [opts.atomKeys] Atom keys to validate
 * @param {string} [opts.rootDir] Module workspace root (default data/kb/req)
 * @param {Record<string, number|string>} [opts.functionIdOverrides] Per-atom function id overrides
 * @param {boolean} [opts.force] When true, duplicate rows do not block (seq increments at commit)
 * @param {typeof findDraftByReqAtomKey} [opts.findDraftFn] Duplicate lookup override
 * @param {(id: number) => Promise<boolean>} [opts.functionIdExists] Injectable
 *   function-id existence check (offline characterization stubs)
 * @returns {Promise<{ ok: string[], problems: Array<{ atomKey: string, code: string, message: string, trajectoryId?: number }>, cache: object }>} Keys that would commit and why the rest would not
 */
export async function validateCommitAtoms({
  moduleKey,
  atomKeys,
  rootDir,
  functionIdOverrides = {},
  force = false,
  findDraftFn,
  functionIdExists = null,
} = {}) {
  const overrides = (functionIdOverrides && typeof functionIdOverrides === 'object')
    ? functionIdOverrides
    : {};
  const keys = Array.isArray(atomKeys) ? atomKeys.map(String) : [];
  const cache = await loadFreshProposeCache(moduleKey, rootDir);
  const byKey = new Map(cache.atoms.map((a) => [a.atomKey, a]));
  const findDraft = findDraftFn || findDraftByReqAtomKey;

  const ok = [];
  const problems = [];
  for (const atomKey of keys) {
    const atom = byKey.get(atomKey);
    if (!atom) {
      problems.push({ atomKey, code: 'unknown_or_stale_atom', message: 'atom not in propose cache' });
      continue;
    }
    const prov = assertAtomProvenance(atom);
    if (!prov.ok) {
      problems.push({ atomKey, code: prov.reason, message: 'atom provenance incomplete' });
      continue;
    }
    const existing = await findDraft(moduleKey, atomKey);
    if (existing && !force) {
      problems.push({
        atomKey,
        code: 'duplicate_draft',
        message: `trajectory ${existing.id} already carries this atom`,
        trajectoryId: existing.id,
      });
      continue;
    }
    const functionId = overrides[atomKey] ?? atom.suggestedFunctionId;
    if (!Number(functionId)) {
      problems.push({ atomKey, code: 'missing_function_id', message: 'no suggestedFunctionId and no override' });
      continue;
    }
    if (!(await isKnownFunctionId(functionId, functionIdExists))) {
      problems.push({ atomKey, code: 'unknown_function_id', message: `functionId ${functionId} not found` });
      continue;
    }
    ok.push(atomKey);
  }
  return { ok, problems, cache };
}

/**
 * Commit selected propose-cache atoms to draft trajectories.
 * Does not call record/prepare or record/start.
 * @param {object} [opts] Commit options
 * @param {string} opts.moduleKey KB req module key
 * @param {string[]} opts.atomKeys Atom keys to commit
 * @param {string} [opts.rootDir] Module workspace root (default data/kb/req)
 * @param {number|null} [opts.systemAccountId] Optional system account id
 * @param {string|null} [opts.paasUserId] Operator PaaS user id (audit passthrough)
 * @param {Record<string, number|string>} [opts.functionIdOverrides] Per-atom function id overrides
 * @param {Record<string, { kbFlowRef?: string|null, kbFlowNodeId?: string|null }>} [opts.flowRefOverrides] Per-atom flow ref overrides
 * @param {boolean} [opts.force] When true, bypass the duplicate skip and take
 *   the next req_atom_seq for that (module, atom); the DB unique index still
 *   converts concurrent races into skipped duplicate_draft
 * @param {typeof analyzeRequirementToPhases} [opts.analyzeFn] Analyze override (characterization)
 * @param {typeof createTransactionWithPhases} [opts.createFn] Create override (characterization)
 * @param {typeof findDraftByReqAtomKey} [opts.findDraftFn] Duplicate lookup override
 * @param {(id: number) => Promise<boolean>} [opts.functionIdExists] Injectable
 *   function-id existence check (offline characterization stubs; defaults to system table)
 * @returns {Promise<{ created: Array<{ trajectoryId: number, atomKey: string, name: string }>, skipped: Array<{ atomKey: string, reason: string, trajectoryId?: number }> }>} Commit result with created and skipped atoms
 */
export async function commitDraftTrajectories({
  moduleKey,
  atomKeys,
  rootDir,
  systemAccountId = null,
  paasUserId = null,
  functionIdOverrides = {},
  flowRefOverrides = {},
  force = false,
  analyzeFn,
  createFn,
  findDraftFn,
  functionIdExists = null,
} = {}) {
  const flowOverrides = (flowRefOverrides && typeof flowRefOverrides === 'object')
    ? flowRefOverrides
    : {};
  const analyze = analyzeFn || analyzeRequirementToPhases;
  const create = createFn || createTransactionWithPhases;
  const findDraft = findDraftFn || findDraftByReqAtomKey;

  const { ok, problems, cache } = await validateCommitAtoms({
    moduleKey,
    atomKeys,
    rootDir,
    functionIdOverrides,
    force,
    findDraftFn,
    functionIdExists,
  });
  const skipped = problems.map(({ atomKey, code, trajectoryId }) => (
    trajectoryId != null ? { atomKey, reason: code, trajectoryId } : { atomKey, reason: code }
  ));
  const byKey = new Map(cache.atoms.map((a) => [a.atomKey, a]));

  const created = [];
  for (const atomKey of ok) {
    const atom = byKey.get(atomKey);
    const functionId = (functionIdOverrides && typeof functionIdOverrides === 'object'
      ? functionIdOverrides[atomKey]
      : undefined) ?? atom.suggestedFunctionId;
    const existing = force ? await findDraft(moduleKey, atomKey) : null;
    const reqAtomSeq = existing ? Number(existing.reqAtomSeq ?? 0) + 1 : 0;
    let analyzed;
    try {
      analyzed = await analyze({ description: atom.taskDraft });
    } catch (e) {
      skipped.push({ atomKey, reason: `analyze_failed:${e.message}` });
      continue;
    }
    const ov = flowOverrides[atomKey] || {};
    const kbFlowRef = ov.kbFlowRef ?? atom.suggestedFlowRef ?? null;
    const kbFlowNodeId = ov.kbFlowNodeId ?? atom.suggestedNodeId ?? null;
    try {
      const traj = await create({
        functionId: Number(functionId),
        name: atom.title,
        requirement: atom.taskDraft,
        phases: analyzed.phases,
        businessEntries: analyzed.businessEntries,
        systemAccountId,
        paasUserId,
        requireFunctionId: true,
        reqModuleKey: moduleKey,
        reqSourcePath: atom.sourceDoc,
        reqChapterRef: atom.sourceChapter,
        reqAtomKey: atom.atomKey,
        reqAtomSeq,
        kbFlowRef,
        kbFlowNodeId,
      });
      const trajectoryId = typeof traj === 'number' ? traj : traj.id;
      created.push({ trajectoryId, atomKey, name: atom.title });
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') {
        skipped.push({ atomKey, reason: 'duplicate_draft' });
        continue;
      }
      skipped.push({ atomKey, reason: `create_failed:${e.message}` });
    }
  }
  return { created, skipped };
}
