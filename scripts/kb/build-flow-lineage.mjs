#!/usr/bin/env node
/**
 * build-flow-lineage.mjs — 从 req 草稿卡反查生成「流程卡 → 模块」血缘资产（recall P0 T1a）。
 *
 * 设计：docs/superpowers/specs/2026-09-10-recall-p0-three-levers-design.md §5.1/§7
 * - 只读 data/kb/req/&lt;moduleKey&gt;/drafts/ 草稿卡（moduleKey/flow/aliases）与 data/kb/flows/ 正式卡，幂等可重复运行；
 * - 血缘只做「卡 → 模块」：草稿侧 flow+aliases 归一化建索引，卡侧同名（去空白精确相等）即命中；
 * - 未映射卡显式入 `unmapped`（多为非需求线产出的早期手工卡，运行时按中性处理）；
 * - 一张卡命中多个模块入 `ambiguous`（同时保留在 `cards`，运行时「任一匹配即同模块」）；
 * - 草稿 promotedTo 指向不存在的卡 → 报错退出（不允许静默，spec §7）。
 *
 * 用法：node scripts/kb/build-flow-lineage.mjs   # 写 data/kb/flow_lineage.json
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REQ_ROOT = 'data/kb/req';
const FLOWS_DIR = 'data/kb/flows';
const OUT_PATH = 'data/kb/flow_lineage.json';

/**
 * 载入流程卡文件名集合与卡对象（stem = 文件名去 .json，与 listFlowCardsDetailed `_stem` 同源）。
 * @returns {{stems: string[], byFile: Map<string, object>}} stem 列表与 文件名→卡 映射
 */
function loadFlowCards() {
  const stems = [];
  const byFile = new Map();
  if (!existsSync(FLOWS_DIR)) throw new Error(`flows 目录不存在: ${FLOWS_DIR}`);
  for (const file of readdirSync(FLOWS_DIR).sort()) {
    if (!file.endsWith('.json')) continue;
    let card = null;
    try {
      card = JSON.parse(readFileSync(join(FLOWS_DIR, file), 'utf-8'));
    } catch (err) {
      throw new Error(`流程卡解析失败: ${file}: ${err.message}`);
    }
    stems.push(file.replace(/\.json$/, ''));
    byFile.set(file, card);
  }
  return { stems, byFile };
}

/**
 * 扫描草稿卡：归一化名称索引（名称 → 模块集合）+ promotedTo 指向校验。
 * @param {Set<string>} flowFiles 流程卡文件名集合（含 .json）
 * @returns {{nameIndex: Map<string, Set<string>>, promotedToErrors: string[]}} 名称索引与悬空指向清单
 */
function loadDraftIndex(flowFiles) {
  const nameIndex = new Map();
  const promotedToErrors = [];
  if (!existsSync(REQ_ROOT)) throw new Error(`req 目录不存在: ${REQ_ROOT}`);
  for (const moduleKey of readdirSync(REQ_ROOT).sort()) {
    const draftsDir = join(REQ_ROOT, moduleKey, 'drafts');
    if (!existsSync(draftsDir)) continue;
    for (const file of readdirSync(draftsDir).sort()) {
      if (!file.endsWith('.json')) continue;
      let draft = null;
      try {
        draft = JSON.parse(readFileSync(join(draftsDir, file), 'utf-8'));
      } catch {
        promotedToErrors.push(`草稿解析失败（跳过）: ${moduleKey}/${file}`);
        continue;
      }
      if (!draft || typeof draft !== 'object') continue;
      // spec §7：血缘指向不存在的卡 → 报错，不允许静默
      if (draft.promotedTo && !flowFiles.has(draft.promotedTo)) {
        promotedToErrors.push(`promotedTo 指向不存在的卡: ${moduleKey}/${file} -> ${draft.promotedTo}`);
      }
      for (const name of [draft.flow, ...(draft.aliases || [])].filter(Boolean)) {
        const key = String(name).replace(/\s+/g, '');
        if (!key) continue;
        if (!nameIndex.has(key)) nameIndex.set(key, new Set());
        nameIndex.get(key).add(draft.moduleKey);
      }
    }
  }
  return { nameIndex, promotedToErrors };
}

/**
 * 主流程：建索引 → 反查每张卡 → 分 mapped/unmapped/ambiguous → 写资产。
 * @returns {number} 退出码
 */
function main() {
  const { stems, byFile } = loadFlowCards();
  const { nameIndex, promotedToErrors } = loadDraftIndex(new Set(byFile.keys()));
  if (promotedToErrors.length > 0) {
    console.error('ERROR: 血缘指向不存在的卡（不允许静默）：');
    for (const e of promotedToErrors) console.error('  ' + e);
    return 1;
  }

  const cards = {};
  const unmapped = [];
  const ambiguous = [];
  for (const [file, card] of byFile) {
    const stem = file.replace(/\.json$/, '');
    const modules = new Set();
    for (const name of [card.flow, ...(card.aliases || [])].filter(Boolean)) {
      const hits = nameIndex.get(String(name).replace(/\s+/g, ''));
      if (hits) for (const m of hits) modules.add(m);
    }
    if (modules.size === 0) unmapped.push(stem);
    else {
      cards[stem] = [...modules].sort();
      if (modules.size >= 2) ambiguous.push({ stem, modules: cards[stem] });
    }
  }

  const asset = {
    lineageVersion: 'v1',
    generatedAt: new Date().toISOString(),
    source: 'data/kb/req/*/drafts/*.json（flow/aliases 去空白精确反查）',
    cards,
    unmapped,
    ambiguous,
  };
  const text = JSON.stringify(asset, null, 2) + '\n';
  JSON.parse(text);
  writeFileSync(OUT_PATH, text, 'utf-8');

  console.log(`flow_lineage.json: mapped=${Object.keys(cards).length} unmapped=${unmapped.length} ambiguous=${ambiguous.length} (总卡 ${stems.length})`);
  if (unmapped.length > 0) console.log('unmapped: ' + unmapped.join(', '));
  for (const a of ambiguous) console.log(`ambiguous: ${a.stem} -> [${a.modules.join(', ')}]`);
  return 0;
}

process.exit(main());
