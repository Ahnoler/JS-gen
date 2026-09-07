// scripts/characterization/characterize-req-draft-traj.mjs (start)
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const dao = await import(pathToFileURL(join(ROOT, 'src/dao/trajectory-dao.js')).href);
assert.equal(typeof dao.findDraftByReqAtomKey, 'function');
console.log('✓ findDraftByReqAtomKey exported');
