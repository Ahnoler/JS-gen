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
  PARTNER_DEBUG_ACCESS_TOKEN,
} from '../../src/services/partner-platform.js';
import { resolve as configResolve } from '../../config/config.js';

assert.equal(PARTNER_NETWORK_ERROR_MSG, '网络异常，自动化平台无法连接');

// 请求方 token 优先（Vue SSO access_token 头透传到伙伴平台，按登录用户身份调用）
assert.equal(resolveAccessToken({ headers: { access_token: 'vue-sso' } }), 'vue-sso');
assert.equal(resolveAccessToken({ headers: { 'access-token': 'h2' } }), 'h2');
assert.equal(resolveAccessToken({ headers: { Access_Token: 'h3' } }), 'h3');
assert.equal(resolveAccessToken({ body: { accessToken: 'b1' } }), 'b1');
assert.equal(resolveAccessToken({ query: { access_token: 'q1' } }), 'q1');

// 无请求 token → PARTNER_ACCESS_TOKEN 回落 → 硬编码联调 JWT（172.20.101.162 联调中）
const fallback = String(configResolve('PARTNER_ACCESS_TOKEN', '') || '').trim();
assert.equal(resolveAccessToken({ headers: {}, body: {} }), fallback || PARTNER_DEBUG_ACCESS_TOKEN);
assert.ok(PARTNER_DEBUG_ACCESS_TOKEN && PARTNER_DEBUG_ACCESS_TOKEN.length > 20, '硬编码联调 JWT 存在');

// requireAccessToken：header/body/query/PARTNER_ACCESS_TOKEN 全无时回落硬编码 JWT（不 400）
assert.equal(requireAccessToken({ headers: {} }), fallback || PARTNER_DEBUG_ACCESS_TOKEN);

const d = resolveSystemProject({});
assert.equal(d.systemId, DEFAULT_PARTNER_SYSTEM_ID);
assert.equal(d.projectId, DEFAULT_PARTNER_PROJECT_ID);

const e = resolveSystemProject({ systemId: 7, projectId: '9' });
assert.equal(e.systemId, '7');
assert.equal(e.projectId, '9');

// toPartnerImportPayload：保留 object/page/popup（仅过滤 null），剥 regionId/regionLabel，screenshot→screenCapture
{
  const src = {
    transcationEventTypeList: [{
      transcId: 1,
      pageId: 'pdCmpt123',
      transcationProperties: [
        { type: 'page', regionId: 'page:x', regionLabel: '首页', screenshot: ['http://a/1.png', 'http://a/2.png'] },
        { type: 'object', regionId: '', regionLabel: '', screenshot: ['http://a/3.png'], rect: '{"x1":1}', propertiesName: '点击', attr: { disabled: true, required: false, readonly: false } },
        { type: 'popup', screenshot: ['http://a/4.png'] },
        null,
      ],
    }],
  };
  const out = toPartnerImportPayload(src);
  const props = out.transcationEventTypeList[0].transcationProperties;
  assert.equal(props.length, 3, 'object/page/popup 全保留，仅 null 被过滤');
  const byType = Object.fromEntries(props.map((p) => [p.type, p]));
  assert.ok(byType.page, 'page 步骤保留');
  assert.ok(byType.popup, 'popup 步骤保留');
  for (const p of props) {
    assert.equal('regionId' in p, false, `${p.type} regionId 已剥除`);
    assert.equal('regionLabel' in p, false, `${p.type} regionLabel 已剥除`);
    assert.equal('attr' in p, false, `${p.type} attr 已剥除（本地/replay 元数据，确认伙伴认后再放开）`);
    assert.equal('screenshot' in p, false, `${p.type} screenshot 已删除（V3 契约改 screenCapture）`);
  }
  assert.equal(byType.page.screenCapture, 'http://a/1.png,http://a/2.png', 'page 截图并入 screenCapture 逗号串');
  assert.equal(byType.object.screenCapture, 'http://a/3.png', 'object 截图并入 screenCapture');
  assert.equal(byType.popup.screenCapture, 'http://a/4.png', 'popup 截图并入 screenCapture');
  assert.equal(byType.object.rect, '{"x1":1}');
  assert.equal(out.transcationEventTypeList[0].transcId, 1);
  assert.equal(out.transcationEventTypeList[0].pageId, 'pdCmpt123', 'entry 级 pageId 透传（与 transcId 同级，驼峰命名）');
}

// 非对象 / 非标准结构原样返回（不崩）
assert.equal(toPartnerImportPayload(null), null);
assert.equal(toPartnerImportPayload('x'), 'x');
assert.deepEqual(toPartnerImportPayload({ transcationEventTypeList: 'nope' }), { transcationEventTypeList: 'nope' });

// section 节点在 toPartnerImportPayload 后保留，type='section'（默认 PARTNER_SECTION_TYPE='section'）
{
  const src = {
    transcationEventTypeList: [{
      transcationProperties: [
        { propertiesID: '1', propertiesPID: '0', type: 'page', screenshot: ['http://x/p.png'], propertiesName: 'page' },
        { propertiesID: '2', propertiesPID: '1', type: 'section', screenshot: [], propertiesName: 'tab1', elementType: '', realLabel: 'tab1' },
        { propertiesID: '3', propertiesPID: '2', type: 'object', screenshot: [], propertiesName: '保存', elementType: '//xpath', realLabel: '保存' },
      ],
    }],
  };
  const out = toPartnerImportPayload(src);
  const props = out.transcationEventTypeList[0].transcationProperties;
  const section = props.find((p) => p.propertiesID === '2');
  assert.ok(section, 'section 节点保留');
  assert.equal(section.type, 'section', 'section type=section（默认）');
  assert.equal('screenshot' in section, false, 'section screenshot key 已删除');
  assert.equal('screenCapture' in section, false, 'section 无 screenCapture（空截图不入串）');
}

console.log('characterize-partner-platform: OK');
