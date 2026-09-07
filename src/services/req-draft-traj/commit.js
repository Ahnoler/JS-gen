/**
 * Commit propose-cache atoms to draft trajectories (analyze → create + provenance).
 */
import { findDraftByReqAtomKey } from '../../dao/trajectory-dao.js';
import { AppError } from '../../http/app-error.js';
import { moduleDir } from '../kb-req-modules.js';
import {
  analyzeRequirementToPhases,
  createTransactionWithPhases,
} from '../trajectory/trajectory-meta-service.js';
import { assertAtomProvenance } from './provenance.js';
import { readProposeCache } from './propose-cache.js';

/**
 * Commit selected propose-cache atoms to draft trajectories.
 * Does not call record/prepare or record/start.
 * @param {object} [opts] Commit options
 * @param {string} opts.moduleKey KB req module key
 * @param {string[]} opts.atomKeys Atom keys to commit
 * @param {string} [opts.rootDir] Module workspace root (default data/kb/req)
 * @param {number|null} [opts.systemAccountId] Optional system account id
 * @param {Record<string, number|string>} [opts.functionIdOverrides] Per-atom function id overrides
 * @param {boolean} [opts.force] When true, skip duplicate-draft check
 * @param {typeof analyzeRequirementToPhases} [opts.analyzeFn] Analyze override (characterization)
 * @param {typeof createTransactionWithPhases} [opts.createFn] Create override (characterization)
 * @param {typeof findDraftByReqAtomKey} [opts.findDraftFn] Duplicate lookup override
 * @returns {Promise<{ created: Array<{ trajectoryId: number, atomKey: string, name: string }>, skipped: Array<{ atomKey: string, reason: string, trajectoryId?: number }> }>} Commit result with created and skipped atoms
 */
export async function commitDraftTrajectories({
  moduleKey,
  atomKeys,
  rootDir,
  systemAccountId = null,
  functionIdOverrides = {},
  force = false,
  analyzeFn,
  createFn,
  findDraftFn,
} = {}) {
  const keys = Array.isArray(atomKeys) ? atomKeys.map(String) : [];
  const cache = await readProposeCache(moduleDir(moduleKey, rootDir));
  if (!cache?.atoms?.length) {
    throw new AppError('propose cache missing — run draft-traj/propose first', { code: 'VALIDATION' });
  }
  const byKey = new Map(cache.atoms.map((a) => [a.atomKey, a]));
  const analyze = analyzeFn || analyzeRequirementToPhases;
  const create = createFn || createTransactionWithPhases;
  const findDraft = findDraftFn || findDraftByReqAtomKey;

  const created = [];
  const skipped = [];
  for (const atomKey of keys) {
    const atom = byKey.get(atomKey);
    if (!atom) {
      skipped.push({ atomKey, reason: 'unknown_or_stale_atom' });
      continue;
    }
    const prov = assertAtomProvenance(atom);
    if (!prov.ok) {
      skipped.push({ atomKey, reason: prov.reason });
      continue;
    }
    if (!force) {
      const existing = await findDraft(moduleKey, atomKey);
      if (existing) {
        skipped.push({ atomKey, reason: 'duplicate_draft', trajectoryId: existing.id });
        continue;
      }
    }
    let analyzed;
    try {
      analyzed = await analyze({ description: atom.taskDraft });
    } catch (e) {
      skipped.push({ atomKey, reason: `analyze_failed:${e.message}` });
      continue;
    }
    const functionId = functionIdOverrides[atomKey] ?? atom.suggestedFunctionId;
    try {
      const traj = await create({
        functionId: functionId != null ? Number(functionId) : undefined,
        name: atom.title,
        requirement: atom.taskDraft,
        phases: analyzed.phases,
        businessEntries: analyzed.businessEntries,
        systemAccountId,
        requireFunctionId: true,
        reqModuleKey: moduleKey,
        reqSourcePath: atom.sourceDoc,
        reqChapterRef: atom.sourceChapter,
        reqAtomKey: atom.atomKey,
      });
      const trajectoryId = typeof traj === 'number' ? traj : traj.id;
      created.push({ trajectoryId, atomKey, name: atom.title });
    } catch (e) {
      skipped.push({ atomKey, reason: `create_failed:${e.message}` });
    }
  }
  return { created, skipped };
}
