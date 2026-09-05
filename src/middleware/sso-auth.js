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
import { createHash, timingSafeEqual } from 'crypto';
import { SSO_AUTH_REQUIRED, DASHBOARD_WS_TOKEN } from '../../config/config.js';
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

// ── Dashboard 访问鉴权（/ws 升级 + /api/browser/*，增量导出，不影响上方 ssoAuth 行为）──

/** 无鉴权放行时只 warn 一次（避免每次连接刷日志） */
let _dashboardNoAuthWarned = false;

/**
 * 常数时间字符串比较：对两侧各取 SHA-256 摘要后 timingSafeEqual，
 * 避免长度差导致的提前返回与长度信息泄漏。
 * @param {string} a 待比较字符串 a
 * @param {string} b 待比较字符串 b
 * @returns {boolean} 是否相等
 */
function timingSafeEqualStr(a, b) {
  const da = createHash('sha256').update(String(a)).digest();
  const db = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(da, db);
}

/**
 * 校验 dashboard 访问令牌（/ws 升级与 /api/browser/* 共用同一套逻辑）。
 * 满足任一即放行：
 * ① env DASHBOARD_WS_TOKEN 已设置且与传入 token 常数时间匹配；
 * ② SSO_AUTH_REQUIRED=true 且 token 为验签有效的 PaaS JWT
 *   （密钥不可用时 fail-closed 返回 false，不降级纯解——此处是安全闸口）；
 * ③ DASHBOARD_WS_TOKEN 未设置且 SSO_AUTH_REQUIRED=false → 放行（向后兼容），
 *   进程内打一次 warn 说明当前无鉴权。
 * @param {string} token 客户端令牌（WS 升级来自 query ?token=；HTTP 可来自 query 或 access_token 头）
 * @returns {Promise<boolean>} 是否放行
 */
export async function verifyDashboardAccessToken(token) {
  if (DASHBOARD_WS_TOKEN) {
    return timingSafeEqualStr(token, DASHBOARD_WS_TOKEN);
  }
  if (SSO_AUTH_REQUIRED) {
    if (!token) return false;
    const secret = await getJwtSecret();
    if (!secret) return false;
    return !!verifyPaasToken(String(token), secret);
  }
  if (!_dashboardNoAuthWarned) {
    _dashboardNoAuthWarned = true;
    console.warn(
      '[sso-auth] DASHBOARD_WS_TOKEN 未设置且 SSO_AUTH_REQUIRED=false：'
      + '/ws 与 /api/browser/* 当前无鉴权（内网暴露风险），建议设置 DASHBOARD_WS_TOKEN 或开启 SSO_AUTH_REQUIRED',
    );
  }
  return true;
}

/**
 * /api/browser/* 访问鉴权中间件：令牌来源 query ?token= 或 access_token 头，
 * 校验逻辑同 verifyDashboardAccessToken（不影响 SSE 响应——仅在中间件层拦截）。
 * @param {import('express').Request} req req
 * @param {import('express').Response} res res
 * @param {import('express').NextFunction} next next
 * @returns {Promise<void>} result
 */
export async function dashboardAccessAuth(req, res, next) {
  const token = String(req.query?.token || req.get('access_token') || '');
  const allowed = await verifyDashboardAccessToken(token).catch(() => false);
  if (!allowed) {
    return res.status(401).json({ code: 401, message: '未登录或令牌无效', data: null });
  }
  next();
}
