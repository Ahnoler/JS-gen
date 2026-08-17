import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_AUTH = [
  {
    id: 'auth',
    name: '登录鉴权（SSO）',
    description: '公司账号中心 SSO：前端无 token 跳 login-page，回调拿 authCode（JWT）当 token 存 localStorage，请求头 access_token 透传。后端从 JWT payload 解 paasUserId 做 /api/v2/* 用户隔离。本周不验签、不调账号中心校验；SSO_AUTH_REQUIRED=false（默认）时无 token 也放行（全可见，向后兼容）。',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/auth/sso/login-page',
        summary: '获取 SSO 登录页地址',
        params: [
          { name: 'uiPath', type: 'string', in: 'query', desc: '登录后回跳的产品地址（= window.location.origin）；缺省用请求 host', example: 'http://172.20.100.14:3000/' },
        ],
        respExample: J({
          code: 200,
          message: 'ok',
          data: { loginUrl: 'http://test.paas.tansun.com.cn/login?appKey=1920710182837141505&redirect=http%3A%2F%2F172.20.100.14%3A3000%2F' },
        }),
        notes: [
          '白名单端点：无需 token。appKey 固定 1920710182837141505（公司分配，后端 config SSO_APP_KEY）',
          '前端拿到 loginUrl 后 window.location.href 跳转；账号中心登录成功回跳 ?authCode=<JWT>',
        ],
      },
      {
        method: 'GET', path: '/api/v2/auth/sso/logout-page',
        summary: '获取 SSO 登出页地址',
        params: [
          { name: 'uiPath', type: 'string', in: 'query', desc: '登出后回跳地址；缺省用请求 host', example: 'http://172.20.100.14:3000/' },
        ],
        respExample: J({ code: 200, message: 'ok', data: { logoutUrl: 'http://test.paas.tansun.com.cn/logout?appKey=1920710182837141505&redirect=...' } }),
        notes: ['白名单端点：无需 token。前端跳前应先清本地 localStorage/sessionStorage'],
      },
      {
        method: 'GET', path: '/api/v2/auth/me',
        summary: '当前登录用户信息',
        respExample: J({ code: 200, message: 'ok', data: { paasUserId: '1510076810578644992' } }),
        notes: [
          '白名单端点：不强制已登录，但无 token/无法解码时 data.paasUserId=null',
          'paasUserId 为账号中心 userId（19 位 long，字符串形式防精度丢失），用作 /api/v2/* 数据隔离标志',
          '本周只返回 paasUserId；用户名友好显示（调账号中心换 userName）后置',
        ],
      },
      {
        method: 'GET', path: '/api/v2/auth/sso/check',
        summary: '校验当前登录态是否有效',
        respExample: J({ code: 200, message: 'ok', data: { valid: true } }),
        notes: ['白名单端点；valid = 能否从 access_token 解出 paasUserId。本周不调账号中心二次校验'],
      },
    ],
  },
];
