/**
 * Characterization: elk-msg-extract parseApiMsg + matchUriWithGatewayPattern.
 * Run: node scripts/characterization/characterize-log-extract.mjs
 */
import { parseApiMsg, matchUriWithGatewayPattern } from '../log-extract/elk-msg-extract.mjs';

let pass = 0;
let fail = 0;

function check(label, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('FAIL: ' + label + (detail ? ' — ' + detail : ''));
  }
}

// a) 完整块（含 Method/URI/Request Body/Response Body/Status/End 标记）
const fullBlock = [
  '===== API Request =====',
  'Method: POST',
  'URI: /custCorporat/saveCustCorporat',
  'Content-Type: application/json',
  'Request Body: {"custNm":"对公客户A","custNo":"C001"}',
  'Response Body: {"code":0,"msg":"ok","data":{"id":123}}',
  'Status: 200',
  '===== API Request End =====',
].join('\n');
const a = parseApiMsg(fullBlock);
check('a ok', a.ok === true, 'ok=' + a.ok);
check('a complete', a.complete === true, 'complete=' + a.complete);
check('a status 200 number', a.status === 200, 'status=' + JSON.stringify(a.status));
check('a requestBody object', typeof a.requestBody === 'object' && a.requestBody !== null && a.requestBody.custNm === '对公客户A', 'requestBody=' + JSON.stringify(a.requestBody));
check('a responseBody object', typeof a.responseBody === 'object' && a.responseBody !== null && a.responseBody.code === 0, 'responseBody=' + JSON.stringify(a.responseBody));
check('a method POST', a.method === 'POST', 'method=' + a.method);
check('a uri', a.uri === '/custCorporat/saveCustCorporat', 'uri=' + a.uri);

// b) 无 End 标记的截断块（只有 Method+URI）
const truncBlock = [
  '===== API Request =====',
  'Method: GET',
  'URI: /custCorporat/getCustCorporat',
].join('\n');
const b = parseApiMsg(truncBlock);
check('b ok', b.ok === true, 'ok=' + b.ok);
check('b complete false', b.complete === false, 'complete=' + b.complete);
check('b method GET', b.method === 'GET', 'method=' + b.method);
check('b uri', b.uri === '/custCorporat/getCustCorporat', 'uri=' + b.uri);
check('b status null', b.status === null, 'status=' + JSON.stringify(b.status));

// c) 多行 pretty JSON Response Body
const prettyBlock = [
  '===== API Request =====',
  'Method: POST',
  'URI: /custCorporat/saveCustCorporat',
  'Content-Type: application/json',
  'Request Body: {"custNm":"对公客户B"}',
  'Response Body: {',
  '  "code": 0,',
  '  "msg": "ok",',
  '  "data": {',
  '    "id": 456,',
  '    "name": "对公客户B"',
  '  }',
  '}',
  'Status: 200',
  '===== API Request End =====',
].join('\n');
const c = parseApiMsg(prettyBlock);
check('c ok', c.ok === true, 'ok=' + c.ok);
check('c complete', c.complete === true, 'complete=' + c.complete);
check('c responseBody object merged', typeof c.responseBody === 'object' && c.responseBody !== null && c.responseBody.data && c.responseBody.data.id === 456, 'responseBody=' + JSON.stringify(c.responseBody));

// d) 脱敏非合法 JSON 响应（未加引号的 **** 使 cstNm 值非法）
const maskedBlock = [
  '===== API Request =====',
  'Method: GET',
  'URI: /custCorporat/getCustCorporat',
  'Content-Type: application/json',
  'Request Body: {"custNo":"C001"}',
  'Response Body: {"code":0,"data":{"cstNm":****,"custNo":"C001"}}',
  'Status: 200',
  '===== API Request End =====',
].join('\n');
const d = parseApiMsg(maskedBlock);
check('d ok', d.ok === true, 'ok=' + d.ok);
check('d responseBody string (non-JSON due to mask)', typeof d.responseBody === 'string', 'typeof responseBody=' + typeof d.responseBody);
check('d bodyTruncated false', d.bodyTruncated === false, 'bodyTruncated=' + d.bodyTruncated);

// e) matchUriWithGatewayPattern
const gwPattern = '/prod-api/tansun-tcp-app-pc/tansun-tcp-cst/custCorporat/saveCustCorporat';
check('e gw same interface true', matchUriWithGatewayPattern('/custCorporat/saveCustCorporat', gwPattern) === true, 'same interface');
check('e gw different interface false', matchUriWithGatewayPattern('/custCorporat/getCustCorporat', gwPattern) === false, 'different interface');
check('e short pattern (no /prod-api/) true', matchUriWithGatewayPattern('/custCorporat/saveCustCorporat', '/custCorporat/saveCustCorporat') === true, 'short pattern same');
check('e short pattern different false', matchUriWithGatewayPattern('/custCorporat/getCustCorporat', '/custCorporat/saveCustCorporat') === false, 'short pattern different');
check('e tansun-tcp- pattern true', matchUriWithGatewayPattern('/custCorporat/saveCustCorporat', '/tansun-tcp-cst/custCorporat/saveCustCorporat') === true, 'tansun-tcp- prefix');

// f) 键无空格变体（"Method: POST" 无空格冒号，Content-Type 带连字符）
const noSpaceBlock = [
  '===== API Request =====',
  'Method:POST',
  'URI:/custCorporat/saveCustCorporat',
  'Content-Type:application/json',
  'Request Body:{"custNm":"对公客户C"}',
  'Response Body:{"code":0}',
  'Status:200',
  '===== API Request End =====',
].join('\n');
const f = parseApiMsg(noSpaceBlock);
check('f ok', f.ok === true, 'ok=' + f.ok);
check('f method POST', f.method === 'POST', 'method=' + JSON.stringify(f.method));
check('f uri', f.uri === '/custCorporat/saveCustCorporat', 'uri=' + JSON.stringify(f.uri));
check('f status 200', f.status === 200, 'status=' + JSON.stringify(f.status));
check('f complete', f.complete === true, 'complete=' + f.complete);

if (fail === 0) {
  console.log('characterize-log-extract: OK');
} else {
  console.log('characterize-log-extract: FAIL (' + fail + ' failed, ' + pass + ' passed)');
}
process.exitCode = fail === 0 ? 0 : 1;
