/**
 * 账号中心 JWT 解码（纯解 payload，不验签）。
 *
 * 账号中心返回的 authCode/token 是 HS256 JWT，payload 含 userId（19 位 long）。
 * 本周策略：纯解 payload 拿 paasUserId，不调账号中心校验、不验签
 *（与已上线产品 test.autotest.tansun.com.cn 取法一致）。
 * userId 保持字符串以防 JS number 精度丢失。
 */

/**
 * 解 HS256 JWT 的 payload。
 *
 * userId 是 19 位 long，JSON.parse 会把它舍成不精确的 number（> 2^53 丢精度），
 * 所以直接从解码后的 JSON 原文提取数字串，保证与账号中心原始值逐位一致。
 * @param {string} token
 * @returns {{ userId: string, iat?: number, jti?: string } | null}
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
