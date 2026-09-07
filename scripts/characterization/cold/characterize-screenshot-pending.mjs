/**
 * Lightweight smoke for screenshot local pending store.
 * Does not require MySQL or MinIO.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate the pending directory so this smoke never touches real pending screenshots.
const testDir = mkdtempSync(path.join(os.tmpdir(), 'jsgen-pending-test-'));
process.env.SCREENSHOT_PENDING_DIR = testDir;

const {
  createPendingFile,
  commitPendingFile,
  readPendingFile,
  deletePendingFile,
  listPendingFiles,
  cleanupPendingFiles,
  getPendingDir,
} = await import('../../src/services/screenshot-pending-store.js');

const buf = Buffer.from('fake-png-bytes');

// create + read temp
const pending = await createPendingFile(buf);
assert.equal(existsSync(pending.filePath), true, 'temp pending file should exist');
assert.deepEqual(await readPendingFile('__not_exist__'), null, 'missing file returns null');

// commit to final id file
await commitPendingFile(pending.filePath, 424242);
const finalPath = path.join(getPendingDir(), '424242.png');
assert.equal(existsSync(finalPath), true, 'committed pending file should exist');
assert.deepEqual(await readPendingFile(424242), buf, 'committed file content matches');

// list contains final file
const files = await listPendingFiles();
assert.ok(files.includes('424242.png'), 'listPendingFiles should include committed file');

// cleanup orphan removes it
await cleanupPendingFiles([]);
assert.equal(existsSync(finalPath), false, 'orphan file should be cleaned');

// delete missing file should not throw
await deletePendingFile(999999);

// cleanup temp dir
rmSync(testDir, { recursive: true, force: true });

console.log('ok: characterize-screenshot-pending');
