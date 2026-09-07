/**
 * Pin: local MinIO-fallback must not leave DB rows without a pending file.
 * - After daoCall succeeds, commitPendingFile failure must remove the DB row.
 * - Startup/orphan purge helper exists for local rows whose file is already gone.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const svc = readFileSync(join(root, 'src/services/screenshot-service.js'), 'utf8');

const fallbackStart = svc.indexOf('async function fallbackToLocal');
assert.ok(fallbackStart >= 0, 'fallbackToLocal exists');
const nextFn = svc.indexOf('\nasync function ', fallbackStart + 10);
const fallbackBody = svc.slice(fallbackStart, nextFn > 0 ? nextFn : fallbackStart + 1200);

assert.match(fallbackBody, /commitPendingFile\s*\(/, 'fallback commits pending file');
assert.match(
  fallbackBody,
  /screenshotDao\.remove\s*\(\s*id\s*\)/,
  'fallback removes DB row when file commit fails',
);
assert.ok(
  fallbackBody.indexOf('commitPendingFile') < fallbackBody.indexOf('screenshotDao.remove'),
  'remove is in the commit-failure path after commitPendingFile',
);

assert.match(
  svc,
  /export async function purgeMissingLocalScreenshots/,
  'purgeMissingLocalScreenshots exported for orphan local rows',
);

const server = readFileSync(join(root, 'server.mjs'), 'utf8');
assert.match(
  server,
  /purgeMissingLocalScreenshots/,
  'server boot purges local rows whose pending file is missing',
);

console.log('ok: characterize-screenshot-fallback');
