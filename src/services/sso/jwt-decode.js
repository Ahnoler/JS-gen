/**
 * 账号中心 JWT 解码 + 验签（HS256）。
 *
 * 账号中心返回的 authCode/token 是 HS256 JWT，payload 含 userId（19 位 long）。
 * - 验签密钥：`query_jwt_secret` 接口返回（如 "paas-application"，Base64 解码后作 HMAC key），
 *   与账号中心 Java SDK（JWTUtil.verifyJWT：SecretKeySpec(Base64.decode(jwtSecret))）一致。
 * - 验签失败返回 null；密钥缺失时调用方可降级为纯解（decodePaasToken），保持可用性。
 * - userId 保持字符串以防 JS number 精度丢失。
 */
import { createHmac } from 'crypto';

/**
 * 解 HS256 JWT 的 payload（不验签）。
 *
 * userId 是 19 位 long，JSON.parse 会把它舍成不精确的 number（> 2^53 丢精度），
 * 所以直接从解码后的 JSON 原文提取数字串，保证与账号中心原始值逐位一致。
 * @param {string} token 账号中心返回的 HS256 JWT 字符串
 * @returns {{ userId: string, iat?: number, jti?: string } | null} 解析成功返回 payload（userId 为字符串），格式非法或无 userId 时返回 null
 */
export function decodePaasToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const text = Buffer.from(b64, 'base64').toString('utf8');
    const payload = JSON.parse(text);
    if (payload?.userId == null) return null;
    const raw = /"userId"\s*:\s*"?(\d+)"?/.exec(text);
    return {
      userId: raw ? raw[1] : String(payload.userId),
      iat: payload.iat,
      jti: payload.jti,
    };
  } catch {
    return null;
  }
}

/**
 * 验签 HS256 JWT 并解 payload。
 * 密钥取法对齐账号中心 SDK：`Buffer.from(secret, 'base64')` 作 HMAC-SHA256 key。
 * @param {string} token 账号中心返回的 HS256 JWT 字符串
 * @param {string} secret 账号中心 JWT 密钥（query_jwt_secret 返回的字符串）
 * @returns {{ userId: string, iat?: number, jti?: string } | null} 验签+解析成功返回 payload，否则 null
 */
export function verifyPaasToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  if (!secret) return null;
  try {
    const key = Buffer.from(String(secret), 'base64');
    const expected = createHmac('sha256', key)
      .update(`${parts[0]}.${parts[1]}`)
      .digest('base64url');
    if (expected !== parts[2]) return null;
    return decodePaasToken(token);
  } catch {
    return null;
  }
}
