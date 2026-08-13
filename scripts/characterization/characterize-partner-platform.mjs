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
  PARTNER_NETWORK_ERROR_MSG,
} from '../../src/services/partner-platform.js';

assert.equal(PARTNER_NETWORK_ERROR_MSG, '网络异常，自动化平台无法连接');

const EXPECTED = (
  process.env.PARTNER_ACCESS_TOKEN
  || 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjE1MTAwNzY4MTA1Nzg2NDQ5OTIsImlhdCI6MTc4MTc0NjMyNCwianRpIjoidG9rZW5JZCJ9.RC81sU9-7mQ7HHxz47dBqIXg0ZWfPGL_uPN0vt-p4qI'
).trim();

// Configured / default partner token wins (not Vue SSO header)
assert.equal(resolveAccessToken({ headers: { access_token: 'vue-sso' } }), EXPECTED);
assert.equal(resolveAccessToken({ headers: {}, body: {} }), EXPECTED);

const d = resolveSystemProject({});
assert.equal(d.systemId, DEFAULT_PARTNER_SYSTEM_ID);
assert.equal(d.projectId, DEFAULT_PARTNER_PROJECT_ID);

const e = resolveSystemProject({ systemId: 7, projectId: '9' });
assert.equal(e.systemId, '7');
assert.equal(e.projectId, '9');

console.log('characterize-partner-platform: OK');
