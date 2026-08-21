/**
 * 账号中心（PaaS ucenter）HTTP 客户端。
 *
 * 对齐账号中心 Java SDK（paas-ucenter-sdk）的调用方式：
 * - query_jwt_secret：JWT 验签密钥（HS256，Base64 解码后作 HMAC key），内存缓存 1h；
 *   配置 SSO_JWT_SECRET 时直接使用、不调接口。
 * - query_access_user：accessToken 换当前用户信息（AccessUserContext.getCurrentUser() 的 HTTP 形态）。
 *
 * 所有调用失败返回 null（调用方降级），不抛异常。
 */
import { SSO_BASE_URL, SSO_APP_KEY, SSO_JWT_SECRET } from '#config/config.js';

const JWT_SECRET_TTL_MS = 60 * 60 * 1000; // 1h
const REQUEST_TIMEOUT_MS = 8000;

let jwtSecretCache = { value: null, at: 0 };

/**
 * 获取 JWT 验签密钥。优先配置 SSO_JWT_SECRET；否则调 query_jwt_secret 并缓存。
 * @returns {Promise<string|null>}
 */
export async function getJwtSecret() {
  const configured = String(SSO_JWT_SECRET || '').trim();
  if (configured) return configured;
  if (jwtSecretCache.value && Date.now() - jwtSecretCache.at < JWT_SECRET_TTL_MS) {
    return jwtSecretCache.value;
  }
  try {
    const url = `${SSO_BASE_URL}/api/ucenter/open/app/query_jwt_secret?appKey=${encodeURIComponent(SSO_APP_KEY)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const json = await res.json();
    const content = json?.body?.content;
    if (typeof content === 'string' && content) {
      jwtSecretCache = { value: content, at: Date.now() };
      return content;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 用 accessToken 回查当前用户信息（对应 SDK AccessUserContext.getCurrentUser()）。
 * @param {string} accessToken 账号中心 JWT
 * @returns {Promise<{ userId?: string, userName?: string, userAccount?: string, gender?: string, avatarAddr?: string, authBy?: string|null } | null>}
 */
export async function getAccessUser(accessToken) {
  const token = String(accessToken || '').trim();
  if (!token) return null;
  try {
    const url = `${SSO_BASE_URL}/api/ucenter/open/access/query_access_user`
      + `?accessToken=${encodeURIComponent(token)}&appKey=${encodeURIComponent(SSO_APP_KEY)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const json = await res.json();
    if (json?.code !== '00000000') return null;
    return json?.body?.content || null;
  } catch {
    return null;
  }
}

/** 测试/热重载辅助：清空密钥缓存（配置变更后立即生效）。 */
export function resetJwtSecretCache() {
  jwtSecretCache = { value: null, at: 0 };
}
