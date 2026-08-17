/**
 * SSO 鉴权中间件（仅 /api/v2/*）。
 *
 * - 从 access_token 请求头解 JWT payload 拿 paasUserId，挂到 req.paasUserId。
 * - SSO_AUTH_REQUIRED=false（默认）：无 token 也放行，req.paasUserId=null（全可见，向后兼容）。
 * - SSO_AUTH_REQUIRED=true：无 token 或 token 无法解码 → 401（走 v2 envelope 包成 {code:401}）。
 * - 白名单 /api/v2/auth/* 不强制已登录（登录页/登出/me/check 本身不能要求 token）。
 */
import { SSO_AUTH_REQUIRED } from '../../config/config.js';
import { decodePaasToken } from '../services/sso/jwt-decode.js';

// 白名单：auth 子路由本身不要求已登录（登录页/登出/me/check）。
// 注意本中间件挂载在 app.use('/api/v2', ssoAuth)，此时 req.path 已去掉 /api/v2 前缀，
// 所以用 req.baseUrl + req.path（=完整挂载点+子路径，不含 query）判断。
const WHITELIST_PREFIX = '/api/v2/auth';

export function ssoAuth(req, res, next) {
  const token = req.get('access_token');
  const decoded = token ? decodePaasToken(token) : null;
  req.paasUserId = decoded?.userId || null;

  const fullPath = `${req.baseUrl || ''}${req.path || ''}`;
  if (fullPath.startsWith(WHITELIST_PREFIX)) {
    return next();
  }
  if (!SSO_AUTH_REQUIRED) return next();
  if (!decoded) {
    return res.status(401).json({ code: 401, message: '未登录或会话已失效', data: null });
  }
  next();
}
