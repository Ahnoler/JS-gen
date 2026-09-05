#!/usr/bin/env node
/**
 * wet-test-check.mjs — req 作业区湿测产物机械验收 checker（防假完成闸门）。
 *
 * 用法：node scripts/kb/wet-test-check.mjs <moduleKey> [moduleKey2 ...]
 *
 * 四类机械检查（对应 USAGE Phase E Lead 验收线，人工抽查仍保留）：
 *  1. 叶集 diff：chapters 章末契约格式 ZJJK 清单行（`ZJJK编号（页面名）`）∪ = 期望叶集，
 *     与 wet-test.md 判定表实际行集比对，报漏叶/多行。
 *  2. 判定统计：match/drift/blocked/not-found/pending 计数。
 *  3. 行级证据校验：所有判定行必含日期；blocked 行必含补测条件/写操作黑名单/同叶引用；
 *     drift 行必含差异类别词。
 *  4. drift 回填覆盖：每个 drift 叶的 ZJJK 应能在本模块 chapters 中与「SUT 实测」标注
 *     同文件出现（缺则 WARN——C 组允许合并引用块）。
 *  退出码：存在 FAIL 项时为 1，否则 0。chapters 无任何契约清单行时直接 FAIL（先跑回补）。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REQ_ROOT = 'data/kb/req';
const VERDICTS = new Set(['match', 'drift', 'blocked', 'not-found', 'pending']);
const DRIFT_CATEGORIES = /wording|behavior|validation|structure|api-?contract|措辞|行为|校验|结构|接口/i;
const BLOCKED_EVIDENCE = /补测条件|写操作黑名单|黑名单|同\s*叶?\s*#?\d+|待有|需以|需.*登录|需.*角色/;

/**
 * 递归列出目录下的 .md 文件（相对传入目录）。
 * @param {string} dir 绝对/相对目录
 * @returns {string[]} 文件路径列表
 */
function listMdFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

/**
 * 从单个 chapters 文件提取契约格式清单行中的 ZJJK 编号。
 * 契约格式：行内出现 `ZJJK编号（页面名）` 即视为清单行；兼容斜杠组（`ZJJKa/ZJJKb（名）`）
 * 与场景后缀（ZJJK…PDCP/PACP，归一化为基础编号）。
 * @param {string} filePath 文件路径
 * @returns {{leaves: string[], hasContractLine: boolean, hasAnyZjjk: boolean}} 叶集与契约行/任一 ZJJK 出现标记
 */
function extractChapterLeaves(filePath) {
  const text = readFileSync(filePath, 'utf-8');
  const leaves = [];
  let hasContractLine = false;
  const leafGroupRe = /ZJJK\d+(?:PDCP|PACP)?(?:\s*\/\s*ZJJK\d+(?:PDCP|PACP)?)*（[^）]*）/g;
  for (const line of text.split(/\r?\n/)) {
    const groups = line.match(leafGroupRe);
    if (groups && groups.length >= 1) {
      hasContractLine = true;
      for (const g of groups) {
        for (const m of g.match(/ZJJK\d+/g) ?? []) leaves.push(m);
      }
    }
  }
  return { leaves: [...new Set(leaves)], hasContractLine, hasAnyZjjk: /ZJJK\d+/.test(text) };
}

/**
 * 汇总模块 chapters 的期望叶集与缺契约行的章节。
 * 无任何 ZJJK 的章节（纯概述）豁免；有 ZJJK 引用但无契约行者视为缺行。
 * @param {string} moduleDir 作业区目录
 * @returns {{expected: string[], missingLineChapters: string[]}} 期望叶集（去重）与缺契约行文件
 */
function collectExpected(moduleDir) {
  const expected = new Set();
  const missingLineChapters = [];
  for (const f of listMdFiles(join(moduleDir, 'chapters'))) {
    const { leaves, hasContractLine, hasAnyZjjk } = extractChapterLeaves(f);
    if (hasAnyZjjk && !hasContractLine) missingLineChapters.push(f.replace(/\\/g, '/'));
    for (const l of leaves) expected.add(l);
  }
  return { expected: [...expected], missingLineChapters };
}

/**
 * 解析 wet-test.md 判定表：提取含判定词的表格行。
 * @param {string} filePath wet-test.md 路径
 * @returns {{rows: Array<{zjjk: string|null, verdict: string, line: string}>, found: boolean}} 行列表与是否找到判定表
 */
function parseWetTest(filePath) {
  const text = readFileSync(filePath, 'utf-8');
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) continue;
    const verdictMatch = line.match(/\|\s*(match|drift|blocked|not-found|pending)\s*\|/);
    if (!verdictMatch) continue;
    const zjjkMatch = line.match(/ZJJK\d+/);
    rows.push({ zjjk: zjjkMatch ? zjjkMatch[0] : null, verdict: verdictMatch[1], line: line.trim() });
  }
  return { rows, found: rows.length > 0 };
}

/**
 * 对单个模块执行四类检查。
 * @param {string} key moduleKey
 * @returns {{fails: string[], warns: string[], stats: Record<string, number>}} 检查结果
 */
function checkModule(key) {
  const moduleDir = join(REQ_ROOT, key);
  const fails = [];
  const warns = [];
  const stats = { match: 0, drift: 0, blocked: 0, 'not-found': 0, pending: 0 };

  if (!existsSync(join(moduleDir, 'wet-test.md'))) {
    return { fails: [`wet-test.md 不存在`], warns, stats };
  }

  // 1. 期望叶集
  const { expected, missingLineChapters } = collectExpected(moduleDir);
  if (expected.length === 0) {
    fails.push('chapters 无任何契约格式 ZJJK 清单行——先按 SKILL「存量回补条款」回补再验收');
  }
  for (const f of missingLineChapters) {
    warns.push(`章节有 ZJJK 引用但章末缺契约清单行: ${f}`);
  }

  // 2/3. 判定表行集与行级证据
  const { rows, found } = parseWetTest(join(moduleDir, 'wet-test.md'));
  if (!found) fails.push('wet-test.md 未解析到任何判定行');
  const actual = new Set();
  const driftLeaves = [];
  for (const r of rows) {
    stats[r.verdict] += 1;
    const codes = r.line.match(/ZJJK\d+/g) ?? [];
    for (const c of codes) actual.add(c);
    if (r.zjjk === null && codes.length === 0 && r.verdict !== 'pending') {
      warns.push(`判定行无 ZJJK（无编号场景叶请确认占行口径）: ${r.line.slice(0, 60)}`);
    }
    if (r.verdict !== 'pending' && !/20\d{2}-\d{2}-\d{2}/.test(r.line)) {
      fails.push(`判定行缺日期: ${r.zjjk ?? '(无ZJJK)'} ${r.verdict}`);
    }
    if (r.verdict === 'blocked' && !BLOCKED_EVIDENCE.test(r.line)) {
      fails.push(`blocked 行缺补测条件/黑名单/同叶引用: ${r.zjjk}`);
    }
    if (r.verdict === 'drift') {
      if (!DRIFT_CATEGORIES.test(r.line)) {
        fails.push(`drift 行缺差异类别词(wording/behavior/validation/structure/api-contract): ${r.zjjk}`);
      }
      if (r.zjjk) driftLeaves.push(r.zjjk);
    }
  }

  // 叶集 diff
  const missing = expected.filter((z) => !actual.has(z));
  const extra = [...actual].filter((z) => !expected.includes(z));
  for (const z of missing) fails.push(`期望叶未在判定表: ${z}`);
  for (const z of extra) warns.push(`判定表有而清单行无（人工确认是否正文叶）: ${z}`);

  // 4. drift 回填覆盖（chapters 同文件含 ZJJK + 「SUT 实测」）
  const chapterTexts = listMdFiles(join(moduleDir, 'chapters')).map((f) => ({
    f: f.replace(/\\/g, '/'),
    text: readFileSync(f, 'utf-8'),
  }));
  for (const z of driftLeaves) {
    const covered = chapterTexts.some((c) => c.text.includes(z) && c.text.includes('SUT 实测'));
    if (!covered) warns.push(`drift 叶回填覆盖未证实（chapters 无 ZJJK+SUT实测同文件）: ${z}`);
  }

  return { fails, warns, stats };
}

// ---- main ----
const keys = process.argv.slice(2);
if (keys.length === 0) {
  console.error('用法: node scripts/kb/wet-test-check.mjs <moduleKey> [...]');
  process.exit(2);
}
let exitCode = 0;
for (const key of keys) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key)) {
    console.error(`[FAIL] 非法 moduleKey: ${key}`);
    exitCode = 1;
    continue;
  }
  const { fails, warns, stats } = checkModule(key);
  console.log(`=== ${key} ===`);
  console.log(
    `统计: match=${stats.match} drift=${stats.drift} blocked=${stats.blocked} not-found=${stats['not-found']} pending=${stats.pending}`
  );
  for (const f of fails) {
    console.log(`FAIL: ${f}`);
    exitCode = 1;
  }
  for (const w of warns) console.log(`WARN: ${w}`);
  if (fails.length === 0 && warns.length === 0) console.log('ALL GREEN');
}
process.exit(exitCode);
