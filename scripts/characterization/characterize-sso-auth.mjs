/**
 * Characterization smoke for SSO auth + paasUserId user isolation.
 *
 * - jwt-decode: 19-digit userId precision (string, not rounded number)
 * - ssoAuth middleware: whitelist /api/v2/auth/*, SSO_AUTH_REQUIRED=false passes w/o token
 * - migration: trajectory + batch_recording_job gain paas_user_id VARCHAR(32) nullable + index
 * - DAO: save stamps paasUserId; list/listByFunction/countByRecordStatus filter on it
 * - routes: req.paasUserId threaded into trajectory + batch handlers
 * Usage: node scripts/characterization/characterize-sso-auth.mjs
 */
import assert from 'assert';
import { readFileSync } from 'fs';
import { createHmac } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { decodePaasToken, verifyPaasToken } from '../../src/services/sso/jwt-decode.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Synthetic JWT (P0-4): self-signed in-script with a test-only secret — no real credentials in repo.
// payload mirrors account-center shape: {"userId":<19-digit long>,"iat":...,"jti":"..."}
const JWT_SECRET = 'test-jwt-secret-for-characterization';
const EXPECTED_USER_ID = '1700000000000000001';

/**
 * Build an HS256 JWT signed the same way verifyPaasToken validates
 * (HMAC-SHA256 over "header.payload" with Buffer.from(secret, 'base64') as key).
 * @param {object|string} payload JWT payload object, or pre-serialized JSON string
 *   (use the string form to keep 19-digit userId exact — JSON.stringify would round it)
 * @param {string} secret signing secret
 * @returns {string} compact serialized JWT
 */
function makeJwt(payload, secret = JWT_SECRET) {
  const b64url = (s) => Buffer.from(s).toString('base64url');
  const head = b64url(JSON.stringify({ alg: 'HS256' }));
  const body = b64url(typeof payload === 'string' ? payload : JSON.stringify(payload));
  const sig = createHmac('sha256', Buffer.from(String(secret), 'base64'))
    .update(`${head}.${body}`)
    .digest('base64url');
  return `${head}.${body}.${sig}`;
}

// Raw numeric payload (account-center shape): 19-digit userId must appear verbatim in the
// signed JSON — JSON.stringify on a JS number would silently round it past 2^53.
const SYNTH_PAYLOAD = `{"userId":${EXPECTED_USER_ID},"iat":1786936984,"jti":"characterization-token"}`;
const SYNTH_JWT = makeJwt(SYNTH_PAYLOAD);

let failed = 0;
function ok(name) { console.log(`  ✓ ${name}`); }
function fail(name, err) { failed += 1; console.error(`  ✗ ${name}:`, err?.message || err); }
function run(name, fn) {
  try { fn(); ok(name); } catch (err) { fail(name, err); }
}
function read(p) { return readFileSync(join(ROOT, p), 'utf8'); }

function main() {
  run('decode synthetic JWT → userId exact 19 digits (no precision loss)', () => {
    const dec = decodePaasToken(SYNTH_JWT);
    assert.ok(dec, 'decoded non-null');
    assert.strictEqual(dec.userId, EXPECTED_USER_ID);
    assert.strictEqual(typeof dec.userId, 'string');
    assert.strictEqual(dec.jti, 'characterization-token');
    // JSON.parse would round the 19-digit userId; guard the regression.
    assert.ok(!dec.userId.endsWith('000'), `userId must not be rounded: ${dec.userId}`);
  });

  run('decode missing/garbage token → null', () => {
    assert.strictEqual(decodePaasToken(null), null);
    assert.strictEqual(decodePaasToken(''), null);
    assert.strictEqual(decodePaasToken('not-a-jwt'), null);
    assert.strictEqual(decodePaasToken('a.b'), null);
    assert.strictEqual(decodePaasToken('a.b.c.d'), null);
  });

  run('decode token without userId → null', () => {
    // payload {"foo":"bar"}, built in-script (no hardcoded JWT literals)
    const tok = makeJwt({ foo: 'bar' });
    assert.strictEqual(decodePaasToken(tok), null);
  });

  run('verify synthetic JWT with test secret → userId exact', () => {
    const verified = verifyPaasToken(SYNTH_JWT, JWT_SECRET);
    assert.ok(verified, 'verified non-null');
    assert.strictEqual(verified.userId, EXPECTED_USER_ID);
  });

  run('verify tampered JWT → null (signature mismatch)', () => {
    const [h, p] = SYNTH_JWT.split('.');
    const tampered = `${h}.${p}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    assert.strictEqual(verifyPaasToken(tampered, JWT_SECRET), null);
  });

  run('verify tampered payload → null (payload swap rejected)', () => {
    const forged = makeJwt({ userId: 999 });
    const [h, , s] = SYNTH_JWT.split('.');
    const forgedBody = forged.split('.')[1];
    assert.strictEqual(verifyPaasToken(`${h}.${forgedBody}.${s}`, JWT_SECRET), null);
  });

  run('verify with wrong/missing secret → null', () => {
    assert.strictEqual(verifyPaasToken(SYNTH_JWT, 'wrong-secret'), null);
    assert.strictEqual(verifyPaasToken(SYNTH_JWT, ''), null);
    assert.strictEqual(verifyPaasToken(SYNTH_JWT, null), null);
    assert.strictEqual(verifyPaasToken('', JWT_SECRET), null);
  });

  run('paas-client: query_jwt_secret + query_access_user + secret cache', () => {
    const src = read('src/services/sso/paas-client.js');
    assert.ok(src.includes('/api/ucenter/open/app/query_jwt_secret'), 'jwt secret uri');
    assert.ok(src.includes('/api/ucenter/open/access/query_access_user'), 'access user uri');
    assert.ok(src.includes('accessToken='), 'token as query param');
    assert.ok(src.includes('appKey='), 'appKey as query param');
    assert.ok(src.includes('JWT_SECRET_TTL_MS'), 'secret cache TTL');
    assert.ok(src.includes('SSO_JWT_SECRET'), 'config override supported');
    assert.ok(src.includes('json?.code !== \'00000000\''), 'envelope code check');
    assert.ok(src.includes('catch {'), 'failures return null (no throw)');
  });

  run('ssoAuth: async verify-first with decode fallback', () => {
    const src = read('src/middleware/sso-auth.js');
    assert.ok(src.includes('export async function ssoAuth'), 'async middleware');
    assert.ok(src.includes('verifyPaasToken(token, secret)'), 'verifies with secret');
    assert.ok(src.includes('getJwtSecret()'), 'loads secret');
    assert.ok(src.includes('decodePaasToken(token)'), 'fallback to pure decode when secret unavailable');
  });

  run('config exports SSO_JWT_SECRET', () => {
    const src = read('config/config.js');
    assert.ok(src.includes("export const SSO_JWT_SECRET"), 'SSO_JWT_SECRET export');
  });

  run('ssoAuth whitelist uses baseUrl+path (mount-aware, not bare req.path)', () => {
    const src = read('src/middleware/sso-auth.js');
    assert.ok(src.includes('WHITELIST_PREFIX = \'/api/v2/auth\''), 'whitelist prefix');
    assert.ok(src.includes('req.baseUrl'), 'uses req.baseUrl (mount-aware)');
    assert.ok(src.includes('req.paasUserId'), 'sets req.paasUserId');
    assert.ok(src.includes('SSO_AUTH_REQUIRED'), 'reads SSO_AUTH_REQUIRED');
    assert.ok(src.includes('res.status(401)'), 'returns 401 when required + no token');
    assert.ok(/return next\(\)/.test(src), 'passes through on success');
  });

  run('v2 __init__ mount order: envelope → ssoAuth → registerAuth → business routes', () => {
    const src = read('src/routes/v2/__init__.js');
    const envIdx = src.indexOf("app.use('/api/v2', v2ResponseEnvelope)");
    const authMwIdx = src.indexOf("app.use('/api/v2', ssoAuth)");
    const regAuthIdx = src.indexOf('registerAuth(app)');
    const regHierIdx = src.indexOf('registerHierarchy(app)');
    assert.ok(envIdx >= 0, 'envelope mounted');
    assert.ok(authMwIdx > envIdx, 'ssoAuth after envelope');
    assert.ok(regAuthIdx > authMwIdx, 'registerAuth after ssoAuth');
    assert.ok(regHierIdx > regAuthIdx, 'business routes after auth');
    assert.ok(src.includes("import { ssoAuth } from '../../middleware/sso-auth.js'"), 'ssoAuth import');
    assert.ok(src.includes("import registerAuth from './auth.js'"), 'registerAuth import');
  });

  run('auth routes: 4 endpoints + sendOk + appKey/base from config', () => {
    const src = read('src/routes/v2/auth.js');
    assert.ok(src.includes("'/api/v2/auth/sso/login-page'"), 'login-page');
    assert.ok(src.includes("'/api/v2/auth/sso/logout-page'"), 'logout-page');
    assert.ok(src.includes("'/api/v2/auth/me'"), 'me');
    assert.ok(src.includes("'/api/v2/auth/sso/check'"), 'check');
    assert.ok(src.includes('SSO_APP_KEY'), 'uses SSO_APP_KEY');
    assert.ok(src.includes('SSO_BASE_URL'), 'uses SSO_BASE_URL');
    assert.ok(src.includes('sendOk'), 'uses sendOk envelope');
    assert.ok(src.includes('req.paasUserId'), 'me/check read req.paasUserId');
  });

  run('auth /me echoes account-center user info (userName/userAccount)', () => {
    const src = read('src/routes/v2/auth.js');
    assert.ok(src.includes("import { getAccessUser }"), 'imports getAccessUser');
    assert.ok(src.includes('userName: user?.userName || null'), 'me returns userName');
    assert.ok(src.includes('userAccount: user?.userAccount || null'), 'me returns userAccount');
  });

  run('config exports SSO_* with 19-digit appKey default', () => {
    const src = read('config/config.js');
    assert.ok(/export const SSO_APP_KEY = _resolve\('SSO_APP_KEY', '\d{19}'\)/.test(src), 'SSO_APP_KEY');
    assert.ok(src.includes("export const SSO_BASE_URL"), 'SSO_BASE_URL');
    assert.ok(src.includes("export const SSO_AUTH_REQUIRED"), 'SSO_AUTH_REQUIRED');
    assert.ok(src.includes("'false').toLowerCase() === 'true'"), 'boolean coerce');
  });

  run('migration: paas_user_id VARCHAR(32) nullable on both tables + indexes', () => {
    const mig = read('migrations/20260818000000_paas_user_id.js');
    assert.ok(mig.includes("hasColumn('trajectory', 'paas_user_id')"), 'trajectory guard');
    assert.ok(mig.includes("hasColumn('batch_recording_job', 'paas_user_id')"), 'batch guard');
    assert.ok(mig.includes("t.string('paas_user_id', 32).nullable()"), 'VARCHAR(32) nullable');
    assert.ok(mig.includes("'idx_trajectory_paas_user_id'"), 'trajectory index');
    assert.ok(mig.includes("'idx_batch_job_paas_user_id'"), 'batch index');
    assert.ok(mig.includes('.after(\'batch_job_id\')'), 'trajectory after batch_job_id');
    assert.ok(mig.includes('.after(\'name\')'), 'batch after name');
  });

  run('init.sql: trajectory has paas_user_id column + index', () => {
    const init = read('schemas/init.sql');
    assert.ok(init.includes('`paas_user_id`      VARCHAR(32) DEFAULT NULL'), 'column');
    assert.ok(init.includes('KEY `idx_trajectory_paas_user_id`'), 'index');
    assert.ok(/账号中心用户 id.*隔离标志/.test(init), 'column comment');
  });

  run('DAO save stamps paasUserId', () => {
    const dao = read('src/dao/trajectory-dao.js');
    assert.ok(dao.includes('paasUserId: trajectory.paasUserId ?? null'), 'save stamps paasUserId');
  });

  run('DAO list/listByFunction filter on paasUserId (empty = all visible)', () => {
    const dao = read('src/dao/trajectory-dao.js');
    assert.ok(/list\(\{[^}]*paasUserId = null/.test(dao), 'list accepts paasUserId');
    assert.ok(/listByFunction\([^,]+,\s*\{[^}]*paasUserId = null/.test(dao), 'listByFunction accepts paasUserId');
    assert.ok(dao.includes("if (paasUserId) query.where('t.paas_user_id', paasUserId)"), 'conditional filter (empty=no-op)');
  });

  run('DAO countByRecordStatus scoped by paasUserId (no stats leak)', () => {
    const dao = read('src/dao/trajectory-dao.js');
    assert.ok(/countByRecordStatus\(\{[^}]*paasUserId = null/.test(dao), 'countByRecordStatus accepts paasUserId');
    // The filter must be applied to countByRecordStatus's own base (otherwise stats leak cross-user).
    // Match the function body precisely: its base alias is `t`, so the filter reads `t.paas_user_id`.
    assert.ok(/export async function countByRecordStatus[\s\S]{0,900}?if \(paasUserId\) base\.where\('t\.paas_user_id', paasUserId\)/.test(dao),
      'countByRecordStatus filters by t.paas_user_id on its own base');
    // And both callers thread paasUserId into the stats call.
    assert.ok(dao.includes('countByRecordStatus({ functionId, keyword, recordStatus, batchTaskName, paasUserId, isExport })'), 'listByFunction threads paasUserId to stats');
    assert.ok(dao.includes('countByRecordStatus({ keyword, recordStatus, batchTaskName, paasUserId, isExport })'), 'list threads paasUserId to stats');
  });

  run('batch DAO createJob stamps paasUserId', () => {
    const dao = read('src/dao/batch-recording-dao.js');
    assert.ok(dao.includes('paasUserId: job.paasUserId ?? null'), 'createJob stamps paasUserId');
  });

  run('meta service threads paasUserId to save', () => {
    const svc = read('src/services/trajectory/trajectory-meta-service.js');
    assert.ok(/createEmptyTrajectory\(\{[^}]*paasUserId = null/.test(svc), 'createEmptyTrajectory accepts paasUserId');
    assert.ok(/createTransactionWithPhases\(\{[^}]*paasUserId = null/.test(svc), 'createTransactionWithPhases accepts paasUserId');
  });

  run('batch service: import stamps + idempotent cross-user 409 + view 404 ownership', () => {
    const svc = read('src/services/trajectory/trajectory-batch-service.js');
    assert.ok(/importBatchFromExcel\(\{[^}]*paasUserId = null/.test(svc), 'import accepts paasUserId');
    assert.ok(svc.includes('Idempotency-Key 已被其他用户占用'), 'idempotent cross-user 409 message');
    assert.ok(/existing\.paasUserId[\s\S]*?String\(paasUserId\)/.test(svc), 'idempotent ownership check');
    assert.ok(/getBatchJobView\([^,]+,\s*\{[^}]*paasUserId = null/.test(svc), 'view accepts paasUserId');
    assert.ok(/job\.paasUserId[\s\S]*?statusCode = 404/.test(svc), 'view 404 on ownership mismatch');
  });

  run('batch analyze threads job.paasUserId into created trajectory', () => {
    const svc = read('src/services/trajectory/batch-analyze.js');
    assert.ok(svc.includes('paasUserId: job.paasUserId || null'), 'analyze passes job.paasUserId to createTransactionWithPhases');
  });

  run('routes thread req.paasUserId into trajectory + batch handlers', () => {
    const traj = read('src/routes/v2/trajectory.js');
    assert.ok(traj.includes('paasUserId: req.paasUserId ?? null'), 'trajectory route passes paasUserId');
    const batch = read('src/routes/v2/trajectory-batch.js');
    assert.ok(batch.includes('paasUserId: req.paasUserId ?? null'), 'batch route passes paasUserId');
  });

  run('api-docs auth group registered', () => {
    const cat = read('src/dashboard/api-docs/catalog.js');
    assert.ok(cat.includes('GROUP_AUTH'), 'catalog imports GROUP_AUTH');
    assert.ok(cat.includes('...GROUP_AUTH,'), 'catalog spreads GROUP_AUTH into API_GROUPS');
    const grp = read('src/dashboard/api-docs/groups/auth.js');
    assert.ok(grp.includes("id: 'auth'"), 'auth group id');
    assert.ok(/appKey|\d{19}/.test(grp), 'appKey documented');
    assert.ok(grp.includes('access_token'), 'header documented');
  });

  const failedCount = failed;
  console.log(failedCount ? `\n${failedCount} failed` : '\nall ok');
  process.exit(failedCount ? 1 : 0);
}

main();
