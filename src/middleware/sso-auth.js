/**
 * SSO 鉴权中间件（仅 /api/v2/*）。
 *
 * - 从 access_token 请求头取 JWT，优先验签（密钥来自账号中心 query_jwt_secret，缓存 1h；
 *   配置 SSO_JWT_SECRET 时直接使用）。验签通过后解 payload 拿 paasUserId，挂到 req.paasUserId。
 * - 密钥不可用（账号中心不可达/未配置且获取失败）时降级为纯解 payload，保持可用性（向后兼容）。
 * - SSO_AUTH_REQUIRED=false（默认）：无 token 也放行，req.paasUserId=null（全可见，向后兼容）。
 * - SSO_AUTH_REQUIRED=true：无 token 或 token 无效 → 401（走 v2 envelope 包成 {code:401}）。
 * - 白名单 /api/v2/auth/* 不强制已登录（登录页/登出/me/check 本身不能要求 token）。
 */
import { SSO_AUTH_REQUIRED } from '../../config/config.js';
import { decodePaasToken, verifyPaasToken } from '../services/sso/jwt-decode.js';
import { getJwtSecret } from '../services/sso/paas-client.js';

// 白名单：auth 子路由本身不要求已登录（登录页/登出/me/check）。
// 注意本中间件挂载在 app.use('/api/v2', ssoAuth)，此时 req.path 已去掉 /api/v2 前缀，
// 所以用 req.baseUrl + req.path（=完整挂载点+子路径，不含 query）判断。
const WHITELIST_PREFIX = '/api/v2/auth';

/**
 * SSO auth middleware: extract + verify JWT, attach req.paasUserId, enforce login when required.
 * @param {import('express').Request} req req
 * @param {import('express').Response} res res
 * @param {import('express').NextFunction} next next
 * @returns {Promise<void>} result
 */
export async function ssoAuth(req, res, next) {
  const token = req.get('access_token');
  let userId = null;
  if (token) {
    const secret = await getJwtSecret();
    if (secret) {
      const verified = verifyPaasToken(token, secret);
      userId = verified?.userId || null;
    } else {
      // 密钥不可用：降级纯解（不验签），保持与旧行为一致
      const decoded = decodePaasToken(token);
      userId = decoded?.userId || null;
    }
  }
  req.paasUserId = userId;

  const fullPath = `${req.baseUrl || ''}${req.path || ''}`;
  if (fullPath.startsWith(WHITELIST_PREFIX)) {
    return next();
  }
  if (!SSO_AUTH_REQUIRED) return next();
  if (!userId) {
    return res.status(401).json({ code: 401, message: '未登录或会话已失效', data: null });
  }
  next();
}
