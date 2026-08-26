/**
 * Local filesystem store for pending screenshot files awaiting MinIO upload.
 * Files live under SCREENSHOT_PENDING_DIR as `{id}.png` (committed) or `.tmp-*.png` (temp).
 */
import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile, rename, unlink, readdir, stat } from 'fs/promises';
import path from 'path';
import {
  SCREENSHOT_PENDING_DIR,
} from '../../config/config.js';

/**
 * Return the configured pending screenshots directory.
 * @returns {string} absolute path to SCREENSHOT_PENDING_DIR
 */
export function getPendingDir() {
  return SCREENSHOT_PENDING_DIR;
}

async function ensureDir() {
  await mkdir(SCREENSHOT_PENDING_DIR, { recursive: true, mode: 0o700 });
}

/**
 * Build the committed pending file path for a given screenshot id.
 * @param {string|number} id screenshot DB id
 * @returns {string} absolute file path `{id}.png`
 */
export function pendingFilePath(id) {
  return path.join(SCREENSHOT_PENDING_DIR, `${id}.png`);
}

/**
 * Write a screenshot to a temporary pending file before attempting MinIO upload.
 * @param {Buffer} buffer PNG image bytes
 * @returns {Promise<{fileName: string, filePath: string}>} temp file name and path
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
 * @param {string} filePath current temp file path
 * @param {string|number} id screenshot DB id
 * @returns {Promise<string>} final committed file path
 */
export async function commitPendingFile(filePath, id) {
  await ensureDir();
  const target = pendingFilePath(id);
  await rename(filePath, target);
  return target;
}

/**
 * Read a pending screenshot file by id; returns null when the file does not exist.
 * @param {string|number} id screenshot DB id
 * @returns {Promise<Buffer|null>} file contents, or null if not found
 */
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
 * @param {string|number} idOrPath screenshot DB id or absolute file path
 * @returns {Promise<void>} resolves when deleted (ENOENT silently ignored)
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

/**
 * List all `.png` file names currently in the pending directory.
 * @returns {Promise<Array<string>>} array of file names ending with `.png`
 */
export async function listPendingFiles() {
  await ensureDir();
  const names = await readdir(SCREENSHOT_PENDING_DIR);
  return names.filter((n) => n.endsWith('.png'));
}

/**
 * Remove orphan local files and old temporary files.
 * @param {Array<string|number>} validIds DB ids that are still storage_type='local'
 * @param {object} [options] cleanup options
 * @param {Array<string|number>} [options.expiredIds] local ids whose local file should be removed (e.g. retry_count >= max and TTL passed)
 * @param {number} [options.tempMaxAgeMs] temporary files older than this are removed
 * @returns {Promise<void>} resolves when cleanup sweep completes
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
