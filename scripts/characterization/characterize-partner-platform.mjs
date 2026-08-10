/**
 * Characterization: partner-platform helpers (token / defaults).
 * Run: node scripts/characterization/characterize-partner-platform.mjs
 */
import assert from 'node:assert/strict';
import {
  resolveAccessToken,
  resolveSystemProject,
  DEFAULT_PARTNER_SYSTEM_ID,
  DEFAULT_PARTNER_PROJECT_ID,
} from '../../src/services/partner-platform.js';

assert.equal(resolveAccessToken({ headers: { access_token: ' abc ' } }), 'abc');
assert.equal(resolveAccessToken({ body: { accessToken: 'from-body' } }), 'from-body');
assert.equal(resolveAccessToken({ headers: {}, body: {} }), process.env.PARTNER_ACCESS_TOKEN?.trim() || null);

const d = resolveSystemProject({});
assert.equal(d.systemId, DEFAULT_PARTNER_SYSTEM_ID);
assert.equal(d.projectId, DEFAULT_PARTNER_PROJECT_ID);

const e = resolveSystemProject({ systemId: 7, projectId: '9' });
assert.equal(e.systemId, '7');
assert.equal(e.projectId, '9');

console.log('characterize-partner-platform: OK');
