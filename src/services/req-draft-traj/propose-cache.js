/**
 * Read/write propose cache for req→draft-traj under a module workspace.
 */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

/** @typedef {import('./propose.js').DraftAtom} DraftAtom */

/** Cache filename under module directory. */
export const PROPOSE_CACHE_FILENAME = '.draft-traj-propose.json';

/**
 * Cache format version — bump on breaking cache shape changes; commit
 * rejects caches whose version differs (STALE_PROPOSE_CACHE).
 */
export const PROPOSE_CACHE_VERSION = 1;

/**
 * Read cached propose result from a module directory.
 * @param {string} moduleDir Absolute module workspace path
 * @returns {Promise<{ cacheVersion: number, updatedAt: string, sourceHash: string, inputHash: string, atoms: DraftAtom[], rejected: Array<{ atomKey?: string, reason: string }>, truncated: { dropped: number, requestedMax: number|null } }|null>} Cached payload or null when missing
 */
export async function readProposeCache(moduleDir) {
  try {
    const raw = await readFile(join(moduleDir, PROPOSE_CACHE_FILENAME), 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') {
      return null;
    }
    throw e;
  }
}

/**
 * Write propose result cache under a module directory (tmp + rename so a
 * crash mid-write never leaves a half-written cache behind).
 * @param {string} moduleDir Absolute module workspace path
 * @param {object} payload Cache body
 * @param {DraftAtom[]} payload.atoms Accepted atoms with full provenance
 * @param {Array<{ atomKey?: string, reason: string }>} payload.rejected Rejected candidates
 * @param {string} [payload.sourceHash] sha256 of through-chains.md at propose time
 * @param {string} [payload.inputHash] sha256 of the propose input shape ({chainIds, maxAtoms})
 * @param {{ dropped: number, requestedMax: number|null }} [payload.truncated] maxAtoms truncation facts
 * @returns {Promise<object>} Written payload (cacheVersion stamped)
 */
export async function writeProposeCache(moduleDir, { atoms, rejected, sourceHash, inputHash, truncated }) {
  const body = {
    cacheVersion: PROPOSE_CACHE_VERSION,
    updatedAt: new Date().toISOString(),
    sourceHash: sourceHash ?? null,
    inputHash: inputHash ?? null,
    atoms,
    rejected,
    truncated: truncated ?? { dropped: 0, requestedMax: null },
  };
  const target = join(moduleDir, PROPOSE_CACHE_FILENAME);
  const tmp = `${target}.tmp`;
  await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, 'utf-8');
  await rename(tmp, target);
  return body;
}
