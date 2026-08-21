/**
 * Characterization: partner-platform helpers (token / defaults).
 * Run: node scripts/characterization/characterize-partner-platform.mjs
 */
import assert from 'node:assert/strict';
import {
  resolveAccessToken,
  requireAccessToken,
  resolveSystemProject,
  DEFAULT_PARTNER_SYSTEM_ID,
  DEFAULT_PARTNER_PROJECT_ID,
  PARTNER_NETWORK_ERROR_MSG,
} from '../../src/services/partner-platform.js';
import { resolve as configResolve } from '../../config/config.js';

assert.equal(PARTNER_NETWORK_ERROR_MSG, '网络异常，自动化平台无法连接');

// 请求方 token 优先（Vue SSO access_token 头透传到伙伴平台，按登录用户身份调用）
assert.equal(resolveAccessToken({ headers: { access_token: 'vue-sso' } }), 'vue-sso');
assert.equal(resolveAccessToken({ headers: { 'access-token': 'h2' } }), 'h2');
assert.equal(resolveAccessToken({ headers: { Access_Token: 'h3' } }), 'h3');
assert.equal(resolveAccessToken({ body: { accessToken: 'b1' } }), 'b1');
assert.equal(resolveAccessToken({ query: { access_token: 'q1' } }), 'q1');

// 无请求 token → PARTNER_ACCESS_TOKEN 回落；两者皆无 → null（硬编码联调 JWT 已移除）
const fallback = String(configResolve('PARTNER_ACCESS_TOKEN', '') || '').trim();
assert.equal(resolveAccessToken({ headers: {}, body: {} }), fallback || null);

// requireAccessToken：header/body/query/PARTNER_ACCESS_TOKEN 全无时 400
if (fallback) {
  assert.equal(requireAccessToken({ headers: {} }), fallback);
} else {
  assert.throws(() => requireAccessToken({ headers: {} }), /access_token is required/);
}

const d = resolveSystemProject({});
assert.equal(d.systemId, DEFAULT_PARTNER_SYSTEM_ID);
assert.equal(d.projectId, DEFAULT_PARTNER_PROJECT_ID);

const e = resolveSystemProject({ systemId: 7, projectId: '9' });
assert.equal(e.systemId, '7');
assert.equal(e.projectId, '9');

console.log('characterize-partner-platform: OK');
