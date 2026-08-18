import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile, rename, unlink, readdir, stat } from 'fs/promises';
import path from 'path';
import {
  SCREENSHOT_PENDING_DIR,
} from '../../config/config.js';

export function getPendingDir() {
  return SCREENSHOT_PENDING_DIR;
}

async function ensureDir() {
  await mkdir(SCREENSHOT_PENDING_DIR, { recursive: true, mode: 0o700 });
}

export function pendingFilePath(id) {
  return path.join(SCREENSHOT_PENDING_DIR, `${id}.png`);
}

/**
 * Write a screenshot to a temporary pending file before attempting MinIO upload.
 * @returns {Promise<{fileName: string, filePath: string}>}
 */
export async function createPendingFile(buffer) {
  await ensureDir();
  const fileName = `.tmp-${Date.now()}-${randomUUID()}.png`;
  const filePath = path.join(SCREENSHOT_PENDING_DIR, fileName);
  await writeFile(filePath, buffer, { mode: 0o600 });
  return { fileName, filePath };
}

/**
 * Move a temporary pending file to its final `{screenshotId}.png` location.
 */
export async function commitPendingFile(filePath, id) {
  await ensureDir();
  const target = pendingFilePath(id);
  await rename(filePath, target);
  return target;
}

export async function readPendingFile(id) {
  try {
    return await readFile(pendingFilePath(id));
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Delete a pending file. Accepts either a screenshot id or a direct file path.
 */
export async function deletePendingFile(idOrPath) {
  const p = typeof idOrPath === 'number' || /^\d+$/.test(String(idOrPath))
    ? pendingFilePath(idOrPath)
    : idOrPath;
  try {
    await unlink(p);
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
}

export async function listPendingFiles() {
  await ensureDir();
  const names = await readdir(SCREENSHOT_PENDING_DIR);
  return names.filter((n) => n.endsWith('.png'));
}

/**
 * Remove orphan local files and old temporary files.
 * @param {Array<string|number>} validIds DB ids that are still storage_type='local'
 * @param {object} [options]
 * @param {Array<string|number>} [options.expiredIds] local ids whose local file should be removed (e.g. retry_count >= max and TTL passed)
 * @param {number} [options.tempMaxAgeMs] temporary files older than this are removed
 */
export async function cleanupPendingFiles(validIds = [], {
  expiredIds = [],
  tempMaxAgeMs = 60 * 60 * 1000,
} = {}) {
  await ensureDir();
  const names = await readdir(SCREENSHOT_PENDING_DIR);
  const valid = new Set(validIds.map(String));
  const expired = new Set(expiredIds.map(String));
  const now = Date.now();

  for (const name of names) {
    const filePath = path.join(SCREENSHOT_PENDING_DIR, name);
    if (name.startsWith('.tmp-')) {
      const st = await stat(filePath).catch(() => null);
      if (!st) continue;
      if (now - st.mtimeMs > tempMaxAgeMs) {
        await unlink(filePath).catch(() => {});
      }
      continue;
    }
    const id = name.replace(/\.png$/, '');
    if (!valid.has(id) || expired.has(id)) {
      await unlink(filePath).catch(() => {});
    }
  }
}
