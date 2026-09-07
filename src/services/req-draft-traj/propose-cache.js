/**
 * Read/write propose cache for req→draft-traj under a module workspace.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** @typedef {import('./propose.js').DraftAtom} DraftAtom */

/** Cache filename under module directory. */
export const PROPOSE_CACHE_FILENAME = '.draft-traj-propose.json';

/**
 * Read cached propose result from a module directory.
 * @param {string} moduleDir Absolute module workspace path
 * @returns {Promise<{ updatedAt: string, atoms: DraftAtom[], rejected: Array<{ atomKey?: string, reason: string }> }|null>} Cached payload or null when missing
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
 * Write propose result cache under a module directory.
 * @param {string} moduleDir Absolute module workspace path
 * @param {object} payload Cache body
 * @param {DraftAtom[]} payload.atoms Accepted atoms with full provenance
 * @param {Array<{ atomKey?: string, reason: string }>} payload.rejected Rejected candidates
 * @returns {Promise<{ updatedAt: string, atoms: DraftAtom[], rejected: Array<{ atomKey?: string, reason: string }> }>} Written payload
 */
export async function writeProposeCache(moduleDir, { atoms, rejected }) {
  const body = {
    updatedAt: new Date().toISOString(),
    atoms,
    rejected,
  };
  await writeFile(
    join(moduleDir, PROPOSE_CACHE_FILENAME),
    `${JSON.stringify(body, null, 2)}\n`,
    'utf-8',
  );
  return body;
}
