#!/usr/bin/env node
/**
 * promote_draft.mjs — req 草稿卡 → 正式流程卡（data/kb/flows/）卡级晋升转换器。
 *
 * 与 promote.py（staging 回流 rules 追加）不同：本脚本做整卡晋升（T1 计划
 * docs/superpowers/plans/2026-09-06-drafts-promote-plan.md §3/§4）。
 *
 * 用法：
 *   node scripts/kb/promote_draft.mjs                 # dry-run：产出 tmp/promote-review.md 审查表，不写 flows
 *   node scripts/kb/promote_draft.mjs --apply         # 按审查表动作写 data/kb/flows/（不删 drafts/ 存档）
 *   node scripts/kb/promote_draft.mjs --card credit-corp/credit-corp-credit-apply.json  # 只处理单卡
 *
 * 晋升条件：coverage.gate ∈ {pass, full, match} 且 steps.length > 0。
 * 同域合并：与既有 flows 卡 flow/aliases/menu_path 前两段相互包含 → 建议 merge（append 去重），否则 new。
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const REQ_ROOT = 'data/kb/req';
const FLOWS_DIR = 'data/kb/flows';
const REVIEW_PATH = 'tmp/promote-review.md';
const PROMOTE_DATE = '2026-09-06';
const ELIGIBLE_GATES = new Set(['pass', 'full', 'match']);
const DEFECT_RE = /缺陷|504|白屏/;
/** 泛化名称黑名单：同域名匹配时跳过（避免「策略管理」⊃「策略管理」式巧合命中） */
const GENERIC_NAMES = new Set(['策略管理', '审批历史', '流程轨迹', '审批记录', '审批意见', '菜单管理']);

/**
 * 步骤名 → kebab slug（保留 CJK，空白/分隔符折叠为 -，去除其他符号）。
 * @param {string} name 步骤名
 * @returns {string} slug
 */
function kebabSlug(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[\s_·・/\\、，。：:（）()【】\[\]]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '') || 'step';
}

/**
 * 截断文本到 max 字符（码点安全）。
 * @param {string} text 原文
 * @param {number} max 最大字符数
 * @returns {string} 截断结果
 */
function clip(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return [...s].length <= max ? s : [...s].slice(0, max).join('') + '…';
}

/**
 * 扫描 data/kb/req/ 下各模块 drafts 目录的草稿卡 JSON，按 gate/steps 过滤并分类。
 * @param {string|null} cardFilter 可选单卡过滤（moduleKey/file.json）
 * @param {string[]} gateWaive Lead 裁决豁免名单（moduleKey/file.json）——gate 不在白名单但 steps>0 的卡强制可晋升
 * @returns {{eligible: Array<{moduleKey: string, file: string, draft: object}>, skipped: Array<{moduleKey: string, file: string, gate: string, reason: string}>}} 合格与被跳过的草稿卡清单
 */
function loadDrafts(cardFilter = null, gateWaive = []) {
  const eligible = [];
  const skipped = [];
  if (!existsSync(REQ_ROOT)) return { eligible, skipped };
  for (const moduleKey of readdirSync(REQ_ROOT).sort()) {
    const draftsDir = join(REQ_ROOT, moduleKey, 'drafts');
    if (!existsSync(draftsDir)) continue;
    for (const file of readdirSync(draftsDir).sort()) {
      if (!file.endsWith('.json')) continue;
      const rel = `${moduleKey}/${file}`;
      if (cardFilter && rel !== cardFilter) continue;
      let draft = null;
      try {
        draft = JSON.parse(readFileSync(join(draftsDir, file), 'utf-8'));
      } catch {
        skipped.push({ moduleKey, file, gate: '(parse-fail)', reason: 'JSON 解析失败' });
        continue;
      }
      const gate = draft?.coverage?.gate || '(none)';
      const stepCount = Array.isArray(draft?.steps) ? draft.steps.length : 0;
      const waived = gateWaive.includes(rel) && stepCount > 0;
      if ((ELIGIBLE_GATES.has(gate) && stepCount > 0) || waived) {
        eligible.push({ moduleKey, file, draft });
      } else {
        const reason = ELIGIBLE_GATES.has(gate)
          ? `steps 为空（${stepCount} 步）`
          : `gate=${gate} 不在晋升白名单`;
        skipped.push({ moduleKey, file, gate, reason });
      }
    }
  }
  return { eligible, skipped };
}

/**
 * 草稿卡 → 正式卡字段转换（计划 §3 映射表）。
 * 返回值不含 state_actions（草稿无可靠状态机证据时省略）。
 * @param {{moduleKey: string, file: string, draft: object}} item 草稿卡条目
 * @returns {{nodes: object[], rules: object[], exceptions: string[], source: string, base: object}} 转换结果（base=flow/aliases 等直传字段）
 */
function convertDraft(item) {
  const { moduleKey, draft } = item;
  const cov = draft.coverage || {};
  const nodes = [];
  const rules = [];
  const seenRuleKeywords = new Set();

  for (const step of draft.steps || []) {
    const page = step.page || step.name;
    const id = kebabSlug(step.name);
    const isDrift = step.verify === 'drift';
    const note = isDrift
      ? `${step.note || ''}（SUT 实测修正）`.trim()
      : (step.note || undefined);
    const enterSrc = step.enter || step.menu_path || draft.menu_path;
    const node = { id, page };
    node.enter = step.enter || (enterSrc ? `菜单 ${enterSrc}` : '');
    if (Array.isArray(step.buttons) && step.buttons.length) node.buttons = step.buttons;
    if (Array.isArray(step.columns) && step.columns.length) node.columns = step.columns;
    if (note) node.note = note;
    nodes.push(node);

    // rules：每步一条（宁缺毋滥）——note 为空则跳过该条
    if (step.note) {
      const keyword = clip(step.name, 8).replace(/\s+/g, '');
      if (keyword && !seenRuleKeywords.has(keyword)) {
        seenRuleKeywords.add(keyword);
        rules.push({
          keyword,
          rule: clip(`${page}：${step.note}`, 100),
          source: `req-promote ${PROMOTE_DATE}`,
        });
      }
    }
  }

  // exceptions：pendingSteps 汇总一条 + SUT 缺陷证据原文
  const exceptions = [];
  const pending = Array.isArray(draft.pendingSteps) ? draft.pendingSteps : [];
  if (pending.length > 0) {
    exceptions.push(
      `待回收步骤 ${pending.length} 项（blocked/not-found，见 data/kb/req/${moduleKey}/wet-test.md 与 _blocked-backlog.md）`
    );
  }
  for (const pre of draft.preconditions || []) {
    if (DEFECT_RE.test(String(pre))) exceptions.push(String(pre));
  }

  const source = `req-promote ${PROMOTE_DATE}（湿测叶 ${cov.total ?? (draft.steps || []).length} 张，match ${cov.match ?? 0}/drift ${cov.drift ?? 0}）`;

  const base = {
    flow: draft.flow,
    aliases: draft.aliases || [],
    hash_markers: draft.hash_markers || [],
    keywords: draft.keywords || [],
    menu_path: draft.menu_path || '',
    preconditions: draft.preconditions || [],
  };
  return { nodes, rules, exceptions, source, base, stemTokens: stemTokens(item.file) };
}

/**
 * 载入既有正式卡（data/kb/flows/*.json）。
 * @returns {Array<{file: string, path: string, card: object}>} 既有卡列表
 */
function loadFlowCards() {
  const out = [];
  if (!existsSync(FLOWS_DIR)) return out;
  for (const file of readdirSync(FLOWS_DIR).sort()) {
    if (!file.endsWith('.json')) continue;
    const path = join(FLOWS_DIR, file);
    try {
      const card = JSON.parse(readFileSync(path, 'utf-8'));
      if (card && typeof card === 'object') out.push({ file, path, card });
    } catch {
      // 既有卡损坏不参与同域判定（apply 时也不会触碰它）
    }
  }
  return out;
}

/**
 * menu_path 前两段域键。
 * @param {string} menuPath 菜单路径
 * @returns {string} 前两段（不足则全量）
 */
function menuDomain(menuPath) {
  return String(menuPath || '').split('/').slice(0, 2).join('/');
}

/**
 * 草稿文件名词干分词（ASCII 段 ≥3 字符；用于同域计分的弱信号）。
 * @param {string} file 草稿文件名
 * @returns {string[]} 词干 token 列表
 */
function stemTokens(file) {
  return file.replace(/\.json$/, '').toLowerCase().split(/[-_]+/).filter((t) => t.length >= 3);
}

/**
 * 同域计分：flow/aliases 名对相互包含（短名 ≥4 字，泛化词黑名单豁免）每对 +3；
 * menu_path 前缀逐段全等：两段全等 +3、仅首段 +1。
 * 文件名词干重叠不加分（仅并列时作 tie-break）。
 * @param {{base: object, stemTokens: string[]}} conv 转换结果（stemTokens=草稿文件名词干分词）
 * @param {object} card 既有正式卡
 * @param {string} cardFile 既有卡文件名
 * @returns {number} 同域得分（0=不同域）
 */
function domainScore(conv, card, cardFile) {
  let score = 0;
  const draftNames = [conv.base.flow, ...conv.base.aliases].filter(Boolean).map((n) => String(n).replace(/\s+/g, ''));
  const cardNames = [card.flow, ...(card.aliases || [])].filter(Boolean).map((n) => String(n).replace(/\s+/g, ''));
  for (const a of draftNames) {
    for (const b of cardNames) {
      if (a.length < 4 || b.length < 4) continue;
      const shorter = a.length <= b.length ? a : b;
      if (GENERIC_NAMES.has(shorter)) continue;
      if (a.includes(b) || b.includes(a)) score += 3;
    }
  }
  const dSegs = String(conv.base.menu_path || '').split('/');
  const cSegs = String(card.menu_path || '').split('/');
  let segMatch = 0;
  for (let i = 0; i < Math.min(dSegs.length, cSegs.length); i += 1) {
    if (dSegs[i] && dSegs[i] === cSegs[i]) segMatch += 1;
    else break;
  }
  if (segMatch >= 2) score += 3;
  else if (segMatch === 1) score += 1;
  // stem 重叠仅作并列裁决信号（不并入主分）
  const cardStem = String(cardFile).replace(/\.json$/, '').toLowerCase().split(/[-_]+/).filter((t) => t.length >= 3);
  for (const t of conv.stemTokens) {
    if (cardStem.includes(t)) score += 0.5;
  }
  return score;
}

/**
 * 同域合并建议：对既有卡逐一计分，取最高分（≥3 视为同域）的既有卡文件名；无则 null。
 * @param {{base: object, stemTokens: string[]}} conv 转换结果
 * @param {Array<{file: string, card: object}>} flowCards 既有卡列表
 * @returns {string|null} 既有卡文件名
 */
function findMergeTarget(conv, flowCards) {
  let best = null;
  let bestScore = 0;
  for (const { file, card } of flowCards) {
    const s = domainScore(conv, card, file);
    if (s > bestScore) {
      best = file;
      bestScore = s;
    }
  }
  return bestScore >= 3 ? best : null;
}

/**
 * 决定每张可晋升卡的动作（new / merge）与目标文件名。
 * 支持 Lead 裁决覆盖：tmp/promote-curation.json = { new: ["module/file.json", ...] }，
 * 列入 new 的卡强制新建（同域检测降级），未列卡维持自动建议。
 * @param {{moduleKey: string, file: string, draft: object}} item 草稿卡条目
 * @param {{nodes: object[], rules: object[], exceptions: string[], source: string, base: object}} conv 转换结果
 * @param {Array<{file: string, card: object}>} flowCards 既有卡列表
 * @param {string[]} forceNew Lead 裁决强制新建清单（"module/file.json"）
 * @returns {{action: 'new'|'merge', target: string, mergeInto: string|null}} 动作与目标
 */
function decideAction(item, conv, flowCards, forceNew) {
  const key = `${item.moduleKey}/${item.file}`;
  const mergeFile = forceNew.includes(key) ? null : findMergeTarget(conv, flowCards);
  if (mergeFile) return { action: 'merge', target: mergeFile, mergeInto: mergeFile };
  // 新建：文件名=草稿文件名，冲突则加模块前缀
  let target = item.file;
  if (flowCards.some((f) => f.file === target)) {
    target = `${item.moduleKey}-${item.file}`;
  }
  return { action: 'new', target, mergeInto: null };
}

/**
 * 构建新建正式卡完整对象。
 * @param {{nodes: object[], rules: object[], exceptions: string[], source: string, base: object}} conv 转换结果
 * @returns {object} 正式卡
 */
function buildNewCard(conv) {
  const card = { ...conv.base, nodes: conv.nodes };
  if (conv.rules.length > 0) card.rules = conv.rules;
  if (conv.exceptions.length > 0) card.exceptions = conv.exceptions;
  card.source = conv.source;
  return card;
}

/**
 * merge 写入：向既有卡 append nodes/rules/exceptions（nodes 按 page 去重、rules 按 keyword 去重、
 * exceptions 按原文去重），source 追加 req-promote 标注；写前 JSON.parse 校验既有文件。
 * @param {string} path 既有卡文件路径
 * @param {{nodes: object[], rules: object[], exceptions: string[], source: string}} conv 转换结果
 * @returns {{writtenNodes: number, writtenRules: number, writtenExceptions: number}} 实际追加数
 */
function applyMerge(path, conv) {
  const card = JSON.parse(readFileSync(path, 'utf-8')); // 写前校验：损坏即抛错不写
  if (!card || typeof card !== 'object') throw new Error(`merge 目标不是对象: ${path}`);
  const result = { writtenNodes: 0, writtenRules: 0, writtenExceptions: 0 };

  card.nodes = Array.isArray(card.nodes) ? card.nodes : [];
  const pages = new Set(card.nodes.map((n) => n?.page));
  for (const n of conv.nodes) {
    if (!pages.has(n.page)) {
      card.nodes.push(n);
      pages.add(n.page);
      result.writtenNodes += 1;
    }
  }

  card.rules = Array.isArray(card.rules) ? card.rules : [];
  const keywords = new Set(card.rules.map((r) => r?.keyword));
  for (const r of conv.rules) {
    if (!keywords.has(r.keyword)) {
      card.rules.push(r);
      keywords.add(r.keyword);
      result.writtenRules += 1;
    }
  }

  card.exceptions = Array.isArray(card.exceptions) ? card.exceptions : [];
  const excSet = new Set(card.exceptions);
  for (const e of conv.exceptions) {
    if (!excSet.has(e)) {
      card.exceptions.push(e);
      excSet.add(e);
      result.writtenExceptions += 1;
    }
  }

  if (!String(card.source || '').includes('req-promote')) {
    card.source = `${card.source || ''}；req-promote ${PROMOTE_DATE}`.replace(/^；/, '');
  }

  writeCard(path, card);
  return result;
}

/**
 * 序列化 + JSON.parse 回读校验后写盘（2 空格缩进 + 末尾换行）。
 * @param {string} path 目标文件路径
 * @param {object} card 卡对象
 * @returns {void}
 */
function writeCard(path, card) {
  const text = JSON.stringify(card, null, 2) + '\n';
  JSON.parse(text); // 写前逐文件校验
  writeFileSync(path, text, 'utf-8');
}

/**
 * 生成 dry-run 审查表 markdown。
 * @param {Array<{moduleKey: string, file: string, conv: object, action: object}>} results 晋升条目
 * @param {Array<{moduleKey: string, file: string, gate: string, reason: string}>} skipped 未晋升条目
 * @returns {string} markdown 全文
 */
function buildReviewMarkdown(results, skipped) {
  const lines = [];
  const newCount = results.filter((r) => r.action.action === 'new').length;
  const mergeCount = results.filter((r) => r.action.action === 'merge').length;
  lines.push('# 晋升审查表（dry-run 生成于 ' + PROMOTE_DATE + '）');
  lines.push('');
  lines.push('> 脚本：`scripts/kb/promote_draft.mjs`；晋升条件：coverage.gate ∈ {pass, full, match} 且 steps>0。');
  lines.push('> 人工过表后 `--apply` 写 flows/（apply 不删 drafts/ 存档）。同域判定为半自动建议，merge 需人工确认。');
  lines.push('');
  lines.push(`## 汇总：可晋升 ${results.length} 张（new ${newCount} / merge ${mergeCount}）；未晋升 ${skipped.length} 张`);
  lines.push('');
  lines.push('| 模块 | 草稿 | 动作 | 目标文件 | nodes | rules | menu_path |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    const menu = clip(r.conv.base.menu_path || '—', 40);
    lines.push(`| ${r.moduleKey} | ${r.file} | ${r.action.action} | ${r.action.target} | ${r.conv.nodes.length} | ${r.conv.rules.length} | ${menu} |`);
  }
  lines.push('');
  lines.push('## 未晋升');
  lines.push('');
  if (skipped.length === 0) {
    lines.push('（无）');
  } else {
    lines.push('| 模块 | 草稿 | gate | 原因 |');
    lines.push('|---|---|---|---|');
    for (const s of skipped) {
      lines.push(`| ${s.moduleKey} | ${s.file} | ${s.gate} | ${s.reason} |`);
    }
  }
  lines.push('');
  lines.push('## 同域合并建议明细');
  lines.push('');
  const merges = results.filter((r) => r.action.action === 'merge');
  if (merges.length === 0) {
    lines.push('（无——所有可晋升卡均建议新建）');
  } else {
    for (const m of merges) {
      lines.push(`- ${m.moduleKey}/${m.file} → merge 进 \`${m.action.target}\`（append nodes ${m.conv.nodes.length}/rules ${m.conv.rules.length}/exceptions ${m.conv.exceptions.length}，按 page+keyword 去重）`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * CLI 入口：默认 dry-run 写审查表；--apply 写 flows；--card 过滤单卡。
 * @returns {Promise<number>} 退出码
 */
async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const cardIdx = argv.indexOf('--card');
  const cardFilter = cardIdx >= 0 ? argv[cardIdx + 1] : null;
  if (cardIdx >= 0 && !cardFilter) {
    console.error('--card 需要 moduleKey/file.json 参数');
    return 2;
  }

  // Lead 裁决覆盖：tmp/promote-curation.json { new: ["module/file.json"] } 强制新建；
  // include: ["module/file.json"] 豁免 gate 白名单（steps 零 blocked 的 partial 主链卡）
  let forceNew = [];
  let gateWaive = [];
  const curationPath = 'tmp/promote-curation.json';
  if (existsSync(curationPath)) {
    try {
      const curation = JSON.parse(readFileSync(curationPath, 'utf-8'));
      forceNew = Array.isArray(curation.new) ? curation.new : [];
      gateWaive = Array.isArray(curation.include) ? curation.include : [];
    } catch {
      console.error('warn: tmp/promote-curation.json 解析失败，忽略覆盖');
    }
  }
  const { eligible, skipped } = loadDrafts(cardFilter, gateWaive);
  const flowCards = loadFlowCards();
  const results = eligible.map((item) => {
    const conv = convertDraft(item);
    const action = decideAction(item, conv, flowCards, forceNew);
    return { ...item, conv, action };
  });

  // 干跑写审查表（dry-run 与 apply 都产出，便于留档核对）
  const md = buildReviewMarkdown(results, skipped);
  mkdirSync('tmp', { recursive: true });
  writeFileSync(REVIEW_PATH, md, 'utf-8');

  const newCount = results.filter((r) => r.action.action === 'new').length;
  const mergeCount = results.filter((r) => r.action.action === 'merge').length;
  console.log(`dry-run: 可晋升 ${results.length} 张（new ${newCount} / merge ${mergeCount}），未晋升 ${skipped.length} 张`);
  console.log(`审查表: ${REVIEW_PATH}`);
  for (const r of results) {
    console.log(`  [${r.action.action}] ${r.moduleKey}/${r.file} -> ${r.action.target} (nodes=${r.conv.nodes.length}, rules=${r.conv.rules.length})`);
  }
  for (const s of skipped) {
    console.log(`  [skip] ${s.moduleKey}/${s.file} gate=${s.gate}（${s.reason}）`);
  }

  if (!apply) {
    console.log('dry-run 完成：未写任何 flows 文件。确认后加 --apply 执行写入。');
    return 0;
  }

  // --apply：按审查表动作写 flows/
  let applied = 0;
  for (const r of results) {
    try {
      if (r.action.action === 'new') {
        const path = join(FLOWS_DIR, r.action.target);
        if (existsSync(path)) {
          console.error(`  [applied-fail] ${r.moduleKey}/${r.file}: 目标已存在（apply 前置冲突）: ${path}`);
          continue;
        }
        writeCard(path, buildNewCard(r.conv));
        console.log(`  [applied-new] ${r.action.target} (nodes=${r.conv.nodes.length}, rules=${r.conv.rules.length})`);
        applied += 1;
      } else {
        const path = join(FLOWS_DIR, r.action.target);
        const w = applyMerge(path, r.conv);
        console.log(`  [applied-merge] ${r.action.target} <- ${r.moduleKey}/${r.file} (+nodes ${w.writtenNodes}, +rules ${w.writtenRules}, +exceptions ${w.writtenExceptions})`);
        applied += 1;
      }
    } catch (err) {
      console.error(`  [applied-fail] ${r.moduleKey}/${r.file}: ${err.message}`);
    }
  }
  console.log(`applied: ${applied}/${results.length} 张已写入 ${FLOWS_DIR}/（drafts/ 存档保留）`);
  return 0;
}

process.exit(await main());
