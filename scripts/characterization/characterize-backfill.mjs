/**
 * Characterization: validate-backfill 纯函数 pin。
 *
 * 覆盖：extractBodyFields（对象/数组/合法 JSON 字符串/非法 JSON 字符串）、
 * buildBackfillKv（命中/未匹配/系统字段/嵌套/脱敏/覆盖率）、matchApiRecord（网关匹配）、
 * summarizeBackfill（聚合统计）。
 *
 * Run: node scripts/characterization/characterize-backfill.mjs
 */
import { extractBodyFields, buildBackfillKv, matchApiRecord, summarizeBackfill } from '../log-extract/validate-backfill.mjs';

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

// 固定小 mapping 夹具（3 字段）
const mapping = {
  api: {
    method: 'POST',
    url: '/prod-api/tansun-tcp-app-pc/tansun-tcp-cst/custCorporat/saveCustCorporat',
  },
  page: { url: '', tab: '', collapse: '' },
  fields: [
    { section: '基本信息', label: '客户编号', prop: 'cstNo', value: '', type: 'textbox' },
    { section: '基本信息', label: '客户名称', prop: 'cstNm', value: '', type: 'textbox' },
    { section: '基本信息', label: '对公客户类型', prop: 'cpctTp', value: '601', display: '企业类', type: 'select' },
  ],
};

// a) 对象 body 提取+命中+覆盖率（2/3 命中、1 个 unknown、coverage=2/3）
const objBody = { cstNo: 'C001', cstNm: '测试公司', sysField: 'X' };
const objRec = { requestBody: objBody, uri: '/custCorporat/saveCustCorporat', method: 'POST' };
const objExtract = extractBodyFields(objBody);
check('a extract fields count 3', objExtract.fields.length === 3, 'fields=' + JSON.stringify(objExtract.fields.map((f) => f.key)));
check('a extract bodyParseable true', objExtract.bodyParseable === true, 'bodyParseable=' + objExtract.bodyParseable);
const objKv = buildBackfillKv(objRec, mapping);
check('a kv count 2 (cstNo,cstNm)', objKv.kv.length === 2, 'kv=' + JSON.stringify(objKv.kv.map((k) => k.prop)));
check('a unmatched count 1', objKv.unmatched.length === 1, 'unmatched=' + JSON.stringify(objKv.unmatched));
check('a unmatched reason unknown', objKv.unmatched[0].reason === 'unknown', 'reason=' + objKv.unmatched[0].reason);
check('a unmatched key sysField', objKv.unmatched[0].key === 'sysField', 'key=' + objKv.unmatched[0].key);
check('a coverage 2/3', Math.abs(objKv.coverage - 2 / 3) < 1e-9, 'coverage=' + objKv.coverage);
check('a label hit cstNm', objKv.kv.find((k) => k.prop === 'cstNm')?.label === '客户名称', 'label=' + objKv.kv.find((k) => k.prop === 'cstNm')?.label);

// b) 字符串合法 JSON body → 正常提取可靠
const validJson = '{"cstNo":"C002","cstNm":"合法公司","cpctTp":"601"}';
const validRec = { requestBody: validJson, uri: '/custCorporat/saveCustCorporat', method: 'POST' };
const validExtract = extractBodyFields(validJson);
check('b extract fields count 3', validExtract.fields.length === 3, 'fields=' + JSON.stringify(validExtract.fields.map((f) => f.key)));
check('b extract bodyParseable true', validExtract.bodyParseable === true, 'bodyParseable=' + validExtract.bodyParseable);
check('b extract reliable true', validExtract.fields.every((f) => f.reliable === true), 'reliable=' + JSON.stringify(validExtract.fields.map((f) => f.reliable)));
const validKv = buildBackfillKv(validRec, mapping);
check('b kv count 3 (all hit)', validKv.kv.length === 3, 'kv=' + JSON.stringify(validKv.kv.map((k) => k.prop)));
check('b coverage 1', validKv.coverage === 1, 'coverage=' + validKv.coverage);
check('b kv display from mapping', validKv.kv.find((k) => k.prop === 'cpctTp')?.display === '企业类', 'display=' + validKv.kv.find((k) => k.prop === 'cpctTp')?.display);
check('b kv disabled null when absent', validKv.kv.find((k) => k.prop === 'cpctTp')?.disabled === null, 'disabled=' + validKv.kv.find((k) => k.prop === 'cpctTp')?.disabled);

// c) 字符串非法 JSON（掩码含裸引号）→ 键名提取成功含 crdtNo,cstNm，reliable:false，bodyParseable:false
const brokenJson = '{"crdtNo":"913301****7XW8T3R","cstNm":""****"公司"}';
const brokenRec = { requestBody: brokenJson, uri: '/custCorporat/saveCustCorporat', method: 'POST' };
const brokenExtract = extractBodyFields(brokenJson);
check('c extract fields include crdtNo', brokenExtract.fields.some((f) => f.key === 'crdtNo'), 'fields=' + JSON.stringify(brokenExtract.fields.map((f) => f.key)));
check('c extract fields include cstNm', brokenExtract.fields.some((f) => f.key === 'cstNm'), 'fields=' + JSON.stringify(brokenExtract.fields.map((f) => f.key)));
check('c extract reliable all false', brokenExtract.fields.every((f) => f.reliable === false), 'reliable=' + JSON.stringify(brokenExtract.fields.map((f) => f.reliable)));
check('c extract bodyParseable false', brokenExtract.bodyParseable === false, 'bodyParseable=' + brokenExtract.bodyParseable);
const brokenKv = buildBackfillKv(brokenRec, mapping);
check('c kv has cstNm hit', brokenKv.kv.some((k) => k.prop === 'cstNm'), 'kv=' + JSON.stringify(brokenKv.kv.map((k) => k.prop)));
check('c unmatched has crdtNo unknown', brokenKv.unmatched.some((u) => u.key === 'crdtNo' && u.reason === 'unknown'), 'unmatched=' + JSON.stringify(brokenKv.unmatched));

// d) masked 检测：值含 **** → masked:true
const maskedBody = { cstNo: 'C001', cstNm: '913301****7XW8T3R' };
const maskedRec = { requestBody: maskedBody, uri: '/custCorporat/saveCustCorporat', method: 'POST' };
const maskedKv = buildBackfillKv(maskedRec, mapping);
check('d cstNm masked true', maskedKv.kv.find((k) => k.prop === 'cstNm')?.masked === true, 'masked=' + maskedKv.kv.find((k) => k.prop === 'cstNm')?.masked);
check('d cstNo masked false', maskedKv.kv.find((k) => k.prop === 'cstNo')?.masked === false, 'masked=' + maskedKv.kv.find((k) => k.prop === 'cstNo')?.masked);

// e) 系统字段归类：id/createInst 等 → reason:"system"
const sysBody = { cstNo: 'C001', id: 123, createInst: 'INST01', updateuser: 'U01' };
const sysRec = { requestBody: sysBody, uri: '/custCorporat/saveCustCorporat', method: 'POST' };
const sysKv = buildBackfillKv(sysRec, mapping);
check('e id reason system', sysKv.unmatched.find((u) => u.key === 'id')?.reason === 'system', 'unmatched=' + JSON.stringify(sysKv.unmatched));
check('e createInst reason system', sysKv.unmatched.find((u) => u.key === 'createInst')?.reason === 'system', 'unmatched=' + JSON.stringify(sysKv.unmatched));
check('e updateuser reason system', sysKv.unmatched.find((u) => u.key === 'updateuser')?.reason === 'system', 'unmatched=' + JSON.stringify(sysKv.unmatched));

// f) 嵌套值（{a:{b:1}}）→ nested:true 且未命中时 reason:"nested"
const nestedBody = { cstNo: 'C001', nestedObj: { b: 1 } };
const nestedRec = { requestBody: nestedBody, uri: '/custCorporat/saveCustCorporat', method: 'POST' };
const nestedExtract = extractBodyFields(nestedBody);
check('f nestedObj nested true', nestedExtract.fields.find((f) => f.key === 'nestedObj')?.nested === true, 'fields=' + JSON.stringify(nestedExtract.fields.map((f) => ({ k: f.key, n: f.nested }))));
const nestedKv = buildBackfillKv(nestedRec, mapping);
check('f nestedObj reason nested', nestedKv.unmatched.find((u) => u.key === 'nestedObj')?.reason === 'nested', 'unmatched=' + JSON.stringify(nestedKv.unmatched));

// f2) 破 JSON 字符串中嵌套数组值 → nested:true 且 reason:"nested"
const brokenNested = '{"cstNo":"C001","beforeFucList":[],"cstNm":""****"公司"}';
const brokenNestedRec = { requestBody: brokenNested, uri: '/custCorporat/saveCustCorporat', method: 'POST' };
const brokenNestedExtract = extractBodyFields(brokenNested);
check('f2 broken string nested flag true', brokenNestedExtract.fields.find((f) => f.key === 'beforeFucList')?.nested === true, 'fields=' + JSON.stringify(brokenNestedExtract.fields.map((f) => ({ k: f.key, n: f.nested }))));
const brokenNestedKv = buildBackfillKv(brokenNestedRec, mapping);
check('f2 broken string reason nested', brokenNestedKv.unmatched.find((u) => u.key === 'beforeFucList')?.reason === 'nested', 'unmatched=' + JSON.stringify(brokenNestedKv.unmatched));

// g) matchApiRecord：网关 url 对 /custCorporat/saveCustCorporat true；对 /custCorporat/getCustCorporat false
const saveRec = { uri: '/custCorporat/saveCustCorporat', method: 'POST' };
const getRec = { uri: '/custCorporat/getCustCorporat', method: 'GET' };
check('g match save true', matchApiRecord(saveRec, mapping).matched === true, 'matched=' + matchApiRecord(saveRec, mapping).matched);
check('g match get false', matchApiRecord(getRec, mapping).matched === false, 'matched=' + matchApiRecord(getRec, mapping).matched);

// h) summarizeBackfill：记录数/覆盖数正确
const sumInput = [
  { uri: '/custCorporat/saveCustCorporat', method: 'POST', kv: [{ prop: 'cstNo', value: 'C1', masked: false, reliable: true }], unmatched: [{ key: 'id', reason: 'system' }], coverage: 0.5, bodyParseable: true },
  { uri: '/custCorporat/saveCustCorporat', method: 'POST', kv: [{ prop: 'cstNo', value: '9***', masked: true, reliable: true }], unmatched: [], coverage: 1, bodyParseable: true },
];
const summary = summarizeBackfill(sumInput, mapping);
check('h records 2', summary.records === 2, 'records=' + summary.records);
check('h interfaces 1', summary.interfaces === 1, 'interfaces=' + summary.interfaces);
check('h kvTotal 2', summary.kvTotal === 2, 'kvTotal=' + summary.kvTotal);
check('h maskedCount 1', summary.maskedCount === 1, 'maskedCount=' + summary.maskedCount);
check('h avgCoverage 0.75', Math.abs(summary.avgCoverage - 0.75) < 1e-9, 'avgCoverage=' + summary.avgCoverage);
check('h bodyParseableCount 2', summary.bodyParseableCount === 2, 'bodyParseableCount=' + summary.bodyParseableCount);
check('h unmatchedByKey has id system', summary.unmatchedByKey.find((u) => u.key === 'id' && u.reason === 'system')?.count === 1, 'unmatchedByKey=' + JSON.stringify(summary.unmatchedByKey));

if (fail === 0) {
  console.log('characterize-backfill: OK');
} else {
  console.log('characterize-backfill: FAIL (' + fail + ' failed, ' + pass + ' passed)');
}
process.exitCode = fail === 0 ? 0 : 1;
