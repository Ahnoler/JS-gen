/**
 * SSO / 当前用户 路由（/api/v2/auth/*）。
 *
 * 这些端点本身不强制已登录（ssoAuth 中间件白名单放行），
 * 但会尽量解码 token 挂 req.paasUserId（me/check 需要返回登录态）。
 */
import { SSO_APP_KEY, SSO_BASE_URL } from '#config/config.js';
import { sendOk } from '../../http/api-response.js';
import { getAccessUser } from '../../services/sso/paas-client.js';

export default function registerAuth(app) {
  // 返回 SSO 登录页地址（前端无 token 时跳转）。uiPath/redirect 来自 query，用于拼回跳。
  app.get('/api/v2/auth/sso/login-page', (req, res) => {
    const redirect = String(req.query.uiPath || req.query.redirect || '').trim()
      || `${req.protocol}://${req.get('host')}/`;
    const loginUrl = `${SSO_BASE_URL}/login?appKey=${SSO_APP_KEY}&redirect=${encodeURIComponent(redirect)}`;
    sendOk(res, { loginUrl });
  });

  // 返回 SSO 登出页地址。
  app.get('/api/v2/auth/sso/logout-page', (req, res) => {
    const redirect = String(req.query.uiPath || req.query.redirect || '').trim()
      || `${req.protocol}://${req.get('host')}/`;
    const logoutUrl = `${SSO_BASE_URL}/logout?appKey=${SSO_APP_KEY}&redirect=${encodeURIComponent(redirect)}`;
    sendOk(res, { logoutUrl });
  });

  // 当前登录用户信息（前端替换硬编码用户名 + 判断登录态）。无 token 时 paasUserId=null。
  // 有 token 时回查账号中心拿 userName/userAccount（AccessUserContext.getCurrentUser 的 HTTP 形态）。
  app.get('/api/v2/auth/me', async (req, res) => {
    const token = req.get('access_token');
    const user = token && req.paasUserId ? await getAccessUser(token) : null;
    sendOk(res, {
      paasUserId: req.paasUserId || null,
      userName: user?.userName || null,
      userAccount: user?.userAccount || null,
    });
  });

  // 校验当前登录态是否有效（占位，前端 checkLogin 用）。
  app.get('/api/v2/auth/sso/check', (req, res) => {
    sendOk(res, { valid: !!req.paasUserId });
  });
}
