/**
 * Characterization: partner-platform helpers (token / defaults).
 * Run: node scripts/characterization/characterize-partner-platform.mjs
 */
import assert from 'node:assert/strict';
import {
  resolveAccessToken,
  requireAccessToken,
  resolveSystemProject,
  toPartnerImportPayload,
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

// toPartnerImportPayload：剥 page/dialog 步骤 + regionId/regionLabel + screenshot→screenshots
{
  const src = {
    transcationEventTypeList: [{
      transcId: 1,
      transcationProperties: [
        { type: 'page', regionId: 'page:x', regionLabel: '首页', screenshot: ['http://a/1.png', 'http://a/2.png'] },
        { type: 'ele', regionId: '', regionLabel: '', screenshot: ['http://a/3.png'], rect: '{"x1":1}', propertiesName: '点击' },
        { type: 'dialog', screenshot: ['http://a/4.png'] },
        null,
      ],
    }],
  };
  const out = toPartnerImportPayload(src);
  const props = out.transcationEventTypeList[0].transcationProperties;
  assert.equal(props.length, 1, 'page/dialog/null 步骤被过滤，仅剩 ele');
  const ele = props[0];
  assert.equal(ele.type, 'ele');
  assert.equal('regionId' in ele, false, 'regionId 已剥除');
  assert.equal('regionLabel' in ele, false, 'regionLabel 已剥除');
  assert.equal('screenshot' in ele, false, 'screenshot 已删除（V3 契约改 screenCapture）');
  assert.equal(ele.screenCapture, 'http://a/3.png', '截图并入 screenCapture 逗号串');
  assert.equal(ele.rect, '{"x1":1}');
  assert.equal(out.transcationEventTypeList[0].transcId, 1);
}

// 非对象 / 非标准结构原样返回（不崩）
assert.equal(toPartnerImportPayload(null), null);
assert.equal(toPartnerImportPayload('x'), 'x');
assert.deepEqual(toPartnerImportPayload({ transcationEventTypeList: 'nope' }), { transcationEventTypeList: 'nope' });

console.log('characterize-partner-platform: OK');
