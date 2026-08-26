#!/usr/bin/env node
/**
 * elk-msg-extract.mjs — ELK 日志解析 / 报文捞取 CLI（最小可行原型）
 *
 * 面向“对公客户管理”（默认 appName=tansun-tcp-cst）模块：从 ELK(ES) 抓取
 * msg 含 ==== API Request ==== 的应用日志，解析出 Method / URI / Content-Type /
 * Request Body / Response Body / Status，连带追踪字段输出为 JSON 文件。
 *
 * 访问方式说明：该 ES 账号不支持按索引名搜索（显式索引名 403 / 通配 0 分片），
 * 必须使用无索引 /_search（与 Kibana discover 等价）；appName 为分词 text 字段，
 * 需用 match_phrase；时间过滤使用 `@timestamp`（date 字段，UTC）。
 *
 * 用法：node scripts/log-extract/elk-msg-extract.mjs --help
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULTS = {
  base: 'http://pc.devtool.elk.tansun.com.cn:9200',
  user: 'tansun',
  pass: 'tansun',
  app: 'tansun-tcp-cst',
  minutes: 15,
  since: null,
  until: null,
  uri: '',
  limit: 0,
  out: '',
  stdout: false,
};

const PAGE_SIZE = 1000;
const MAX_FROM = 10000;
const MAX_LIMIT = 50000;
const MAX_BODY_CHARS = 200000;

const USAGE = `elk-msg-extract — ELK 日志解析 / 报文捞取（对公客户管理 MVP）

用法:
  node scripts/log-extract/elk-msg-extract.mjs [选项]

选项:
  --base URL       ES 地址 (默认 ${DEFAULTS.base})
  --user U         ES 账号 (默认 ${DEFAULTS.user})
  --pass P         ES 密码 (默认 ${DEFAULTS.pass})
  --app NAME       appName 过滤 (默认 ${DEFAULTS.app})
  --minutes N      抓取最近 N 分钟 (默认 ${DEFAULTS.minutes}; 与 --since/--until 互斥)
  --since ISO      起始时间, 例 2026-08-26T21:00:00+08:00 (UTC 或带时区 ISO)
  --until ISO      结束时间
  --uri PATTERN    URI 过滤: 无 * 时子串匹配(大小写不敏感), 含 * 时通配匹配
  --limit N        最多输出条数 (0=不限, 上限 ${MAX_LIMIT})
  --out FILE       输出 JSON 文件路径
  --stdout         只打印摘要, 不写文件
  --help           显示本帮助
`;

/**
 * 解析 --key value / --key=value 形式的命令行参数。
 * @param {string[]} argv process.argv 切片
 * @returns {{opts: object, help: boolean}} 解析结果
 */
function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { help = true; continue; }
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    const key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    const value = eq >= 0 ? arg.slice(eq + 1) : (i + 1 < argv.length ? argv[++i] : '');
    switch (key) {
      case 'base': opts.base = value; break;
      case 'user': opts.user = value; break;
      case 'pass': opts.pass = value; break;
      case 'app': opts.app = value; break;
      case 'minutes': opts.minutes = Number(value); break;
      case 'since': opts.since = value; break;
      case 'until': opts.until = value; break;
      case 'uri': opts.uri = value; break;
      case 'limit': opts.limit = Number(value); break;
      case 'out': opts.out = value; break;
      case 'stdout': opts.stdout = true; break;
      default: throw new Error(`未知参数: --${key}`);
    }
  }
  return { opts, help };
}

/**
 * 将用户输入的 ISO 时间转换为 UTC ISO 字符串（ES range 用）。
 * @param {string} iso 用户输入 ISO 时间
 * @returns {string} UTC ISO 字符串
 */
function toUtcIso(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`无法解析时间: ${iso}`);
  return d.toISOString();
}

/**
 * 构造 ES 查询体（无索引 /_search，与 Kibana discover 过滤器等价）。
 * @param {object} opts 已解析的参数
 * @returns {object} ES 查询 body
 */
function buildQuery(opts) {
  const must = [
    { match_phrase: { msg: '===== API Request =====' } },
    { match_phrase: { appName: opts.app } },
  ];
  const range = {};
  if (opts.since) range.gte = toUtcIso(opts.since);
  if (opts.until) range.lte = toUtcIso(opts.until);
  if (opts.minutes && !opts.since) range.gte = new Date(Date.now() - opts.minutes * 60000).toISOString();
  if (Object.keys(range).length > 0) must.push({ range: { '@timestamp': range } });
  return { size: PAGE_SIZE, query: { bool: { must } }, sort: [{ '@timestamp': 'asc' }, { _id: 'asc' }], track_total_hits: true };
}

const KNOWN_KEYS = new Set(['method', 'uri', 'content-type', 'request body', 'response body', 'status']);
const KEY_LINE_RE = /^([A-Za-z][A-Za-z -]*?)\s*:\s?(.*)$/;
const START_RE = /^=+\s*API Request\s*=+$/;
const END_RE = /^=+\s*API Request End\s*=+$/;

/** 已知字段的取值规整映射（status 数字化、body 的 JSON 解析延迟到收尾）。 */
const FIELD_NAMES = {
  method: 'method',
  uri: 'uri',
  'content-type': 'contentType',
  status: 'status',
};

/**
 * 解析单条 API Request 报文块。
 *
 * 支持：等号 3~9 个、键与冒号间空格数量可变、RequestBody/ResponseBody 多行或非 JSON、
 * 字段缺失等；非已知键的形如 "Key : value" 行归入 extra。
 * @param {string} msg 日志文档 msg 字段原文
 * @returns {object} 解析结果 { ok, method, uri, contentType, status, requestBody, responseBody, bodyTruncated, extra, error }
 */
export function parseApiMsg(msg) {
  const result = { ok: false, method: null, uri: null, contentType: null, status: null, requestBody: null, responseBody: null, bodyTruncated: false, extra: {}, error: null };
  const text = typeof msg === 'string' ? msg : '';
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (START_RE.test(lines[i].trim())) { start = i; break; }
  }
  if (start < 0) { result.error = 'no-block'; return result; }
  const raw = { method: null, uri: null, contentType: null, status: null, 'request body': null, 'response body': null };
  let cur = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (END_RE.test(trimmed) || (/^=+$/.test(trimmed) && trimmed.length > 0)) break;
    const m = KEY_LINE_RE.exec(line);
    if (m) {
      const key = m[1].trim().toLowerCase();
      if (KNOWN_KEYS.has(key)) {
        cur = key;
        raw[key] = m[2];
        continue;
      }
      // 非已知键：仅在正文尚未开始（cur 为 null）时收进 extra，避免误切 JSON 内容行
      if (cur === null && m[1].trim() !== '') {
        result.extra[m[1].trim()] = m[2];
        continue;
      }
    }
    if (cur !== null && (cur === 'request body' || cur === 'response body')) {
      raw[cur] = (raw[cur] === null ? '' : raw[cur]) + '\n' + line;
    }
  }
  result.ok = true;
  for (const key of Object.keys(FIELD_NAMES)) {
    const val = raw[key];
    if (val === null || val === undefined) continue;
    if (key === 'status' && /^\d+$/.test(val)) {
      result.status = Number(val);
    } else {
      result[FIELD_NAMES[key]] = val;
    }
  }
  for (const key of ['request body', 'response body']) {
    const val = raw[key];
    if (val === null) continue;
    let body;
    try {
      body = JSON.parse(val.trim());
    } catch {
      body = val;
    }
    if (typeof body === 'string' && body.length > MAX_BODY_CHARS) {
      result.bodyTruncated = true;
      body = body.slice(0, MAX_BODY_CHARS);
    }
    if (key === 'request body') result.requestBody = body;
    else result.responseBody = body;
  }
  return result;
}

/**
 * 将 ES 命中转换为输出记录。
 * @param {object} hit ES 命中项
 * @param {object} parsed parseApiMsg 的结果
 * @returns {object} 输出记录
 */
function toRecord(hit, parsed) {
  const src = hit._source || {};
  const host = typeof src.host === 'string' ? src.host : (src.host && src.host.name) || null;
  return {
    t: src['@timestamp'] ?? null,
    logdate: src.logdate ?? null,
    appName: src.appName ?? null,
    env: src.environment ?? null,
    index: hit._index ?? null,
    method: parsed.method,
    uri: parsed.uri,
    status: parsed.status,
    contentType: parsed.contentType,
    requestBody: parsed.requestBody,
    responseBody: parsed.responseBody,
    bodyTruncated: parsed.bodyTruncated,
    globalTraceNo: src.globalTraceNo ?? null,
    localTraceNo: src.localTraceNo ?? null,
    parentTraceNo: src.parentTraceNo ?? null,
    host,
    class: src.class ?? null,
    thread: src.thread ?? null,
    level: src.level ?? null,
    msgLength: typeof src.msg === 'string' ? src.msg.length : 0,
  };
}

/** 网络/HTTP 致命错误（认证、权限、4xx 客户端错误）。 */
class EsError extends Error {}

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

/**
 * 执行一次 ES POST /_search（无索引），带重试与鉴权。
 * @param {object} body ES 查询体
 * @param {object} opts 已解析的参数
 * @returns {Promise<object>} ES 响应 JSON
 */
async function esSearch(body, opts) {
  const auth = 'Basic ' + Buffer.from(opts.user + ':' + opts.pass).toString('base64');
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(opts.base.replace(/\/$/, '') + '/_search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (resp.ok) return await resp.json();
      const txt = await resp.text().catch(() => '');
      const msg = `HTTP ${resp.status}: ${txt.slice(0, 300)}`;
      if (resp.status === 401) throw new EsError('认证失败 (401)，请检查 --user/--pass 或账号权限');
      if (resp.status === 403) throw new EsError('权限不足 (403)，该账号不支持按索引名搜索');
      if (resp.status >= 400 && resp.status < 500) throw new EsError(msg);
      throw new Error(msg);
    } catch (err) {
      if (err instanceof EsError) throw err;
      lastErr = err;
      if (attempt < 2) await sleep(1000);
    }
  }
  throw new EsError(`网络请求失败（重试 3 次后仍失败）: ${lastErr?.message ?? String(lastErr)}`);
}

/**
 * 构造 URI 匹配器：无 * 时子串匹配，含 * 时通配匹配（均大小写不敏感）。
 * @param {string} pattern 用户输入的 --uri 值
 * @returns {((uri: string) => boolean) | null} 匹配函数，pattern 为空时为 null
 */
function buildUriMatcher(pattern) {
  if (!pattern) return null;
  if (pattern.includes('*')) {
    const re = new RegExp('^' + pattern.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
    return (uri) => re.test(uri || '');
  }
  const needle = pattern.toLowerCase();
  return (uri) => String(uri || '').toLowerCase().includes(needle);
}

/**
 * 主流程：查询 ES、解析、写入文件/打印摘要。
 * @param {object} opts 已解析的参数
 * @returns {Promise<number>} 退出码
 */
async function main(opts) {
  const matcher = buildUriMatcher(opts.uri);
  const effectiveLimit = opts.limit > 0 ? Math.min(opts.limit, MAX_LIMIT) : 0;
  const records = [];
  let total = 0;
  let parseFailed = 0;
  const failSamples = [];
  let usedSearchAfter = true;
  let searchAfter = null;
  let from = 0;

  while (records.length < effectiveLimit || effectiveLimit === 0) {
    const body = buildQuery(opts);
    body.sort = usedSearchAfter ? [{ '@timestamp': 'asc' }, { _id: 'asc' }] : [{ '@timestamp': 'asc' }];
    if (usedSearchAfter) { if (searchAfter) body.search_after = searchAfter; }
    else if (from > 0) body.from = from;
    let resp;
    try {
      resp = await esSearch(body, opts);
    } catch (err) {
      const msg = String(err.message || '');
      if (usedSearchAfter && /sort|_id|fielddata|search_after/i.test(msg)) {
        console.error('[提示] search_after 分页不可用，降级为 from/size 分页');
        usedSearchAfter = false;
        continue;
      }
      throw err;
    }
    total = resp.hits?.total?.value ?? total;
    const page = resp.hits?.hits ?? [];
    for (const hit of page) {
      const parsed = parseApiMsg(hit._source?.msg);
      if (!parsed.ok) {
        parseFailed++;
        if (failSamples.length < 5) failSamples.push(String(hit._source?.msg ?? '').slice(0, 200).replace(/\r?\n/g, ' '));
        continue;
      }
      if (matcher && !matcher(parsed.uri)) continue;
      records.push(toRecord(hit, parsed));
      if (effectiveLimit > 0 && records.length >= effectiveLimit) break;
    }
    if (effectiveLimit > 0 && records.length >= effectiveLimit) break;
    if (page.length === 0) break;
    if (usedSearchAfter) {
      const last = page[page.length - 1];
      searchAfter = [last.sort?.[0], last._id];
    } else {
      from += page.length;
      if (from >= MAX_FROM) { console.warn('[提示] 达到 from 分页安全上限，结果可能不完整'); break; }
    }
  }

  // 控制台摘要
  const times = records.map((r) => r.logdate).filter(Boolean);
  console.log(`窗口: ${times.length ? times[0] : '?'} ~ ${times.length ? times[times.length - 1] : '?'} (本地时间)`);
  console.log(`命中: ${total} | 写入: ${records.length} | 解析失败: ${parseFailed}`);
  console.log('URI 分布 (前 40):');
  const uriCounts = new Map();
  for (const r of records) uriCounts.set(r.uri ?? 'null', (uriCounts.get(r.uri ?? 'null') ?? 0) + 1);
  [...uriCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([u, c]) => console.log(`  ${c.toString().padStart(4)}  ${u}`));
  console.log('Status 分布:');
  const statusCounts = new Map();
  for (const r of records) { const k = String(r.status ?? 'null'); statusCounts.set(k, (statusCounts.get(k) ?? 0) + 1); }
  [...statusCounts.entries()].sort((a, b) => b[1] - a[1]).forEach(([s, c]) => console.log(`  ${c.toString().padStart(4)}  ${s}`));
  if (parseFailed > 0) {
    console.log('解析失败样本:');
    failSamples.forEach((s) => console.log('  - ' + s));
  }
  if (!opts.stdout) {
    const outPath = opts.out || resolve('logs', 'log-extract-' + new Date().toISOString().replace(/[:.]/g, '').slice(0, 15) + '.json');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(records, null, 2));
    console.log('文件: ' + outPath);
  }
  return 0;
}

/**
 * CLI 入口。
 * @returns {Promise<number>} 退出码
 */
async function cli() {
  try {
    const { opts, help } = parseArgs(process.argv.slice(2));
    if (help) { console.log(USAGE); return 0; }
    if (!Number.isFinite(opts.minutes) || opts.minutes <= 0) throw new Error('--minutes 必须是正整数');
    return await main(opts);
  } catch (err) {
    console.error('错误: ' + (err?.message ?? err));
    return 1;
  }
}

process.exitCode = await cli();
