#!/usr/bin/env node
/**
 * validate-backfill.mjs — 报文→表单回填验证 CLI。
 *
 * 将 ELK 捞取的 saveCustCorporat 报文（elk-msg-extract.mjs 输出）与字段映射样本
 * （docs/superpowers/specs/saveCustCorporat-field-mapping.json）对齐，逐条比对
 * requestBody 键值与映射字段，产出回填覆盖率 / 脱敏标注 / 未匹配 key 统计。
 *
 * 纯函数（extractBodyFields / buildBackfillKv / matchApiRecord / summarizeBackfill）
 * 供 characterization pin；CLI 负责读文件、过滤、写报告。
 *
 * 用法：node scripts/log-extract/validate-backfill.mjs --input <records.json> --mapping <field-mapping.json> --out <report.json> [--md <report.md>]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { matchUriWithGatewayPattern } from './elk-msg-extract.mjs';

/**
 * 确定系统字段集合（小写）。仅纳入确凿的系统/审计字段；拿不准的不放入，统一归 unknown。
 */
const SYSTEM_KEYS = new Set([
  'id', 'createinst', 'createuser', 'createtime',
  'updateinst', 'updateuser', 'updatetime',
  'hdlinst', 'hdluser', 'hdltime',
  'version', 'tenantid', 'delind',
]);

/**
 * 从键名正则匹配中捕获到下一个逗号/花括号的值片段，并去除外层引号（best-effort）。
 * @param {string} text 原始字符串（非法 JSON）
 * @param {number} colonIndex 冒号在 text 中的索引
 * @returns {string} 提取的值片段（已去引号、去首尾空白）
 */
function extractBestEffortValue(text, colonIndex) {
  let i = colonIndex + 1;
  while (i < text.length && /\s/.test(text[i])) i++;
  const start = i;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === ',' || ch === '}') break;
  }
  let raw = text.slice(start, i).trim();
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
  return raw;
}

/**
 * 从对象 body 顶层逐键提取字段；值对象/数组标记 nested:true 且不展开。
 * @param {object} body 已确认为对象的 body
 * @param {boolean} parseable body 是否可解析
 * @returns {{fields: Array<{key:string,value:unknown,reliable:boolean,nested:boolean}>, bodyParseable: boolean}} 提取结果
 */
function extractFromObject(body, parseable) {
  const fields = [];
  for (const [key, value] of Object.entries(body)) {
    const isNested = (typeof value === 'object' && value !== null);
    fields.push({ key, value: isNested ? null : value, reliable: parseable, nested: isNested });
  }
  return { fields, bodyParseable: parseable };
}

/**
 * 从数组 body 各元素对象键并集提取字段；非对象元素跳过；value 取第一个出现的值。
 * @param {Array} body 已确认为数组的 body
 * @param {boolean} parseable body 是否可解析
 * @returns {{fields: Array<{key:string,value:unknown,reliable:boolean,nested:boolean}>, bodyParseable: boolean}} 提取结果
 */
function extractFromArray(body, parseable) {
  const seen = new Map();
  for (const el of body) {
    if (typeof el !== 'object' || el === null || Array.isArray(el)) continue;
    for (const [key, value] of Object.entries(el)) {
      if (!seen.has(key)) {
        const isNested = (typeof value === 'object' && value !== null);
        seen.set(key, { key, value: isNested ? null : value, reliable: parseable, nested: isNested });
      }
    }
  }
  return { fields: [...seen.values()], bodyParseable: parseable };
}

/**
 * 从字符串 body（JSON.parse 失败）用键名正则提取字段，值 best-effort，每条 reliable:false。
 * @param {string} text 非法 JSON 字符串
 * @returns {{fields: Array<{key:string,value:string,reliable:boolean,nested:boolean}>, bodyParseable: boolean}} 提取结果
 */
function extractFromBrokenString(text) {
  const fields = [];
  const seen = new Set();
  const re = /"([A-Za-z][A-Za-z0-9_]*)":/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1];
    if (seen.has(key)) continue;
    seen.add(key);
    const colonIndex = m.index + m[0].length - 1; // 指向冒号
    const rawValue = extractBestEffortValue(text, colonIndex);
    const isNested = rawValue.startsWith('[') || rawValue.startsWith('{');
    fields.push({ key, value: isNested ? null : rawValue, reliable: false, nested: isNested });
  }
  return { fields, bodyParseable: false };
}

/**
 * 提取 body 字段列表。
 *
 * - body 为非空对象 → 顶层逐键（值对象/数组 → nested:true 且不展开）。
 * - body 为数组 → 各元素对象键并集（value 取第一个出现的值；非对象元素跳过）。
 * - body 为字符串 → 先 JSON.parse，成功按对象/数组处理；失败 → 键名正则
 *   /"([A-Za-z][A-Za-z0-9_]*)":/g 提取（去重保持顺序），值 best-effort，每条
 *   reliable:false，bodyParseable:false。
 * @param {object|Array|string} body 报文 requestBody（对象 / 数组 / 字符串）
 * @returns {{fields: Array<{key:string,value:unknown,reliable:boolean,nested:boolean}>, bodyParseable: boolean}} 提取结果
 */
export function extractBodyFields(body) {
  if (typeof body === 'object' && body !== null) {
    if (Array.isArray(body)) return extractFromArray(body, true);
    return extractFromObject(body, true);
  }
  if (typeof body === 'string') {
    if (body.trim() === '') return { fields: [], bodyParseable: false };
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return extractFromBrokenString(body);
    }
    if (typeof parsed === 'object' && parsed !== null) {
      if (Array.isArray(parsed)) return extractFromArray(parsed, true);
      return extractFromObject(parsed, true);
    }
    // JSON.parse 出非对象（数字/字符串/布尔/null）→ 无键可提取
    return { fields: [], bodyParseable: true };
  }
  return { fields: [], bodyParseable: false };
}

/**
 * 构建 mapping.fields 的 prop→field 索引（小写 prop 健壮匹配）。
 * @param {object} mapping 字段映射样本
 * @returns {Map<string, object>} 小写 prop → field 条目
 */
function buildFieldIndex(mapping) {
  const idx = new Map();
  const fields = Array.isArray(mapping?.fields) ? mapping.fields : [];
  for (const f of fields) {
    if (f && typeof f.prop === 'string') {
      idx.set(f.prop.toLowerCase(), f);
    }
  }
  return idx;
}

/**
 * 判断值是否为脱敏值（包含连续 2 个及以上星号）。
 * @param {unknown} value 待判定值
 * @returns {boolean} 是否脱敏
 */
function isMaskedValue(value) {
  if (typeof value !== 'string') return false;
  return /\*{2,}/.test(value);
}

/**
 * 构建报文→表单回填 KV 对照（仅用 requestBody）。
 *
 * kv 顺序 = 报文键序；masked = 值匹配 /\*{2,}/；label/section/type 取自
 * mapping.fields 按 prop 命中（小写匹配）；未命中键归类：SYSTEM_KEYS 集合 →
 * reason:"system"；嵌套值 → reason:"nested"；其余 → unknown。coverage = 命中数/总键数。
 * @param {object} record ELK 输出记录（仅使用 requestBody）
 * @param {object} mapping 字段映射样本
 * @returns {{kv: Array<{prop:string,label:(string|null),section:(string|null),type:(string|null),value:unknown,masked:boolean,reliable:boolean}>, unmatched: Array<{key:string,reason:string}>, coverage: number, bodyParseable: boolean}} 回填对照结果
 */
export function buildBackfillKv(record, mapping) {
  const fieldIndex = buildFieldIndex(mapping);
  const { fields, bodyParseable } = extractBodyFields(record?.requestBody);
  const kv = [];
  const unmatched = [];
  let hit = 0;
  for (const f of fields) {
    const fieldDef = fieldIndex.get(f.key.toLowerCase());
    if (fieldDef) {
      hit++;
      kv.push({
        prop: f.key,
        label: fieldDef.label ?? null,
        section: fieldDef.section ?? null,
        type: fieldDef.type ?? null,
        value: f.value,
        masked: isMaskedValue(f.value),
        reliable: f.reliable,
      });
    } else {
      const lower = f.key.toLowerCase();
      let reason;
      if (f.nested) reason = 'nested';
      else if (SYSTEM_KEYS.has(lower)) reason = 'system';
      else reason = 'unknown';
      unmatched.push({ key: f.key, reason });
    }
  }
  const total = fields.length;
  const coverage = total > 0 ? hit / total : 0;
  return { kv, unmatched, coverage, bodyParseable };
}

/**
 * 判断记录 URI 是否命中映射接口（网关前缀段级后缀匹配）。
 * @param {object} record ELK 输出记录
 * @param {object} mapping 字段映射样本
 * @returns {{matched: boolean}} 是否命中
 */
export function matchApiRecord(record, mapping) {
  const pattern = mapping?.api?.url ?? '';
  const uri = record?.uri ?? '';
  return { matched: matchUriWithGatewayPattern(uri, pattern) };
}

/**
 * 聚合回填验证结果。
 *
 * 统计：records（命中记录数）、matchedRecords、interfaces（唯一命中 uri+method）、
 * kvTotal、maskedCount、avgCoverage、unmatchedByKey（按 key 计数 top20 含 reason）、
 * bodyParseableCount。
 * @param {Array<object>} results 每条命中记录的 buildBackfillKv 结果数组
 * @param {object} mapping 字段映射样本
 * @returns {{records: number, matchedRecords: number, interfaces: number, kvTotal: number, maskedCount: number, avgCoverage: number, unmatchedByKey: Array<{key:string,reason:string,count:number}>, bodyParseableCount: number}} 聚合统计
 */
export function summarizeBackfill(results, mapping) {
  let kvTotal = 0;
  let maskedCount = 0;
  let coverageSum = 0;
  let bodyParseableCount = 0;
  const ifaceSet = new Set();
  const unmatchedCounts = new Map();
  const records = Array.isArray(results) ? results : [];
  for (const r of records) {
    kvTotal += Array.isArray(r.kv) ? r.kv.length : 0;
    if (Array.isArray(r.kv)) {
      for (const kv of r.kv) {
        if (kv.masked) maskedCount++;
      }
    }
    coverageSum += typeof r.coverage === 'number' ? r.coverage : 0;
    if (r.bodyParseable) bodyParseableCount++;
    if (r.uri && r.method) ifaceSet.add(r.uri + ' ' + r.method);
    if (Array.isArray(r.unmatched)) {
      for (const u of r.unmatched) {
        const k = u.key + '\x00' + u.reason;
        const prev = unmatchedCounts.get(k);
        if (prev) prev.count++;
        else unmatchedCounts.set(k, { key: u.key, reason: u.reason, count: 1 });
      }
    }
  }
  const unmatchedByKey = [...unmatchedCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  const avgCoverage = records.length > 0 ? coverageSum / records.length : 0;
  return {
    records: records.length,
    matchedRecords: records.length,
    interfaces: ifaceSet.size,
    kvTotal,
    maskedCount,
    avgCoverage,
    unmatchedByKey,
    bodyParseableCount,
  };
}

/**
 * 解析 --key value / --key=value 形式的命令行参数。
 * @param {string[]} argv process.argv 切片
 * @returns {{opts: object, help: boolean}} 解析结果
 */
function parseArgs(argv) {
  const opts = { input: '', mapping: '', out: '', md: '' };
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { help = true; continue; }
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    const key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    const value = eq >= 0 ? arg.slice(eq + 1) : (i + 1 < argv.length ? argv[++i] : '');
    switch (key) {
      case 'input': opts.input = value; break;
      case 'mapping': opts.mapping = value; break;
      case 'out': opts.out = value; break;
      case 'md': opts.md = value; break;
      default: throw new Error('未知参数: --' + key);
    }
  }
  return { opts, help };
}

/**
 * 渲染 Markdown 摘要报告。
 * @param {Array<object>} recordReports 每条命中记录报告
 * @param {object} summary summarizeBackfill 聚合结果
 * @param {string} mappingPath 映射文件路径（用于注明来源）
 * @returns {string} Markdown 文本
 */
function renderMarkdown(recordReports, summary, mappingPath) {
  const lines = [];
  lines.push('<!-- 映射源为样本 saveCustCorporat-field-mapping.json (' + mappingPath + ') -->');
  lines.push('# 报文→表单回填验证报告');
  lines.push('');
  lines.push('**映射源**：' + mappingPath);
  lines.push('');
  lines.push('## 总体统计');
  lines.push('');
  lines.push('- 命中记录数：' + summary.records);
  lines.push('- 命中接口数：' + summary.interfaces);
  lines.push('- KV 总条数：' + summary.kvTotal);
  lines.push('- 脱敏值数：' + summary.maskedCount);
  lines.push('- 平均覆盖率：' + (summary.avgCoverage * 100).toFixed(1) + '%');
  lines.push('- body 可解析记录数：' + summary.bodyParseableCount);
  lines.push('');
  lines.push('## 接口清单');
  lines.push('');
  const ifaces = new Map();
  for (const r of recordReports) {
    const k = r.uri + ' ' + r.method;
    ifaces.set(k, (ifaces.get(k) ?? 0) + 1);
  }
  lines.push('| URI | Method | 条数 |');
  lines.push('| --- | --- | --- |');
  for (const [k, c] of ifaces.entries()) {
    const [u, m] = k.split(' ');
    lines.push('| ' + u + ' | ' + m + ' | ' + c + ' |');
  }
  lines.push('');
  lines.push('## KV 样例（前 30 条，取首条命中记录）');
  lines.push('');
  const firstKv = recordReports[0]?.kv ?? [];
  lines.push('| prop | 中文名 | 类型 | 值 | 脱敏 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const kv of firstKv.slice(0, 30)) {
    const val = String(kv.value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push('| ' + kv.prop + ' | ' + (kv.label ?? '') + ' | ' + (kv.type ?? '') + ' | ' + val + ' | ' + (kv.masked ? '是' : '否') + ' |');
  }
  lines.push('');
  lines.push('## 未匹配 key 统计（top 20）');
  lines.push('');
  lines.push('| key | reason | 次数 |');
  lines.push('| --- | --- | --- |');
  for (const u of summary.unmatchedByKey) {
    lines.push('| ' + u.key + ' | ' + u.reason + ' | ' + u.count + ' |');
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * CLI 入口：读文件、过滤、写报告。
 * @returns {Promise<number>} 退出码
 */
async function cli() {
  try {
    const { opts, help } = parseArgs(process.argv.slice(2));
    if (help) {
      console.log('validate-backfill — 报文→表单回填验证');
      console.log('用法: node scripts/log-extract/validate-backfill.mjs --input <records.json> --mapping <field-mapping.json> --out <report.json> [--md <report.md>]');
      return 0;
    }
    if (!opts.input) throw new Error('缺少 --input');
    if (!opts.mapping) throw new Error('缺少 --mapping');
    if (!opts.out) throw new Error('缺少 --out');

    const records = JSON.parse(readFileSync(resolve(opts.input), 'utf8'));
    const mapping = JSON.parse(readFileSync(resolve(opts.mapping), 'utf8'));
    if (!Array.isArray(records)) throw new Error('--input 必须是记录数组');

    let total = records.length;
    let skippedUnmatched = 0;
    const recordReports = [];
    const kvResults = [];
    for (const rec of records) {
      if (rec?.complete === false) continue;
      const { matched } = matchApiRecord(rec, mapping);
      if (!matched) { skippedUnmatched++; continue; }
      const { kv, unmatched, coverage, bodyParseable } = buildBackfillKv(rec, mapping);
      const report = {
        uri: rec.uri ?? null,
        method: rec.method ?? null,
        logdate: rec.logdate ?? null,
        coverage,
        kv,
        unmatched,
        bodyParseable,
      };
      recordReports.push(report);
      kvResults.push({ uri: rec.uri, method: rec.method, kv, unmatched, coverage, bodyParseable });
    }

    const summary = summarizeBackfill(kvResults, mapping);
    const reportJson = {
      summary,
      records: recordReports,
      skippedUnmatched,
      inputTotal: total,
    };

    const outPath = resolve(opts.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(reportJson, null, 2));

    if (opts.md) {
      const mdPath = resolve(opts.md);
      mkdirSync(dirname(mdPath), { recursive: true });
      writeFileSync(mdPath, renderMarkdown(recordReports, summary, opts.mapping));
    }

    console.log('记录总数: ' + total);
    console.log('命中接口数: ' + summary.interfaces);
    console.log('命中记录数: ' + summary.records);
    console.log('平均覆盖率: ' + (summary.avgCoverage * 100).toFixed(1) + '%');
    console.log('脱敏数: ' + summary.maskedCount);
    console.log('未匹配 top: ' + (summary.unmatchedByKey.slice(0, 5).map((u) => u.key + '(' + u.reason + ' x' + u.count + ')').join(', ') || '无'));
    console.log('body 可解析: ' + summary.bodyParseableCount + '/' + summary.records);
    console.log('未命中接口跳过: ' + skippedUnmatched);
    console.log('报告 JSON: ' + outPath);
    if (opts.md) console.log('报告 MD: ' + resolve(opts.md));
    return 0;
  } catch (err) {
    console.error('错误: ' + (err?.message ?? err));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await cli();
}
