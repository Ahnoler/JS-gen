/**
 * A1 回填：解析 data/kb/flows/*.json 的 source 自由文本 → source_refs 结构化溯源。
 * 默认 --dry-run 只打印；--apply 才写盘；仅写 source_refs 键，绝不触碰卡片其他字段。
 * 执行时机（spec 定案）：后置——KB 线 WIP 提交、data/kb/flows 无未提交改动后单独跑。
 * 用法：node migrations/backfill-kb-source-refs.mjs [--apply]
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FLOWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'kb', 'flows');
const APPLY = process.argv.includes('--apply');

/**
 * 解析 source 文本中的溯源 ID（高置信正则）。
 * @param {string} source 卡片 source 自由文本
 * @returns {{ trajectory_ids: string[], tx_nos: string[], dates: string[] }} 三类引用（可为空数组）
 */
export function parseSourceRefs(source) {
  const s = String(source || '');
  const trajectoryIds = [...new Set(s.match(/\d{15,}/g) || [])];
  const txNos = [];
  for (const m of s.matchAll(/交易\s*#?(\d{3})(?:\s*-\s*(\d{3}))?/g)) {
    txNos.push(m[1]);
    if (m[2]) txNos.push(m[2]);
  }
  const txUnique = [...new Set(txNos)];
  const dates = [...new Set(s.match(/\d{4}-\d{2}-\d{2}/g) || [])];
  return { trajectory_ids: trajectoryIds, tx_nos: txUnique, dates };
}

const names = (await readdir(FLOWS_DIR)).filter((n) => n.endsWith('.json')).sort();
const report = [];
for (const name of names) {
  const path = join(FLOWS_DIR, name);
  const raw = await readFile(path, 'utf-8');
  let card;
  try {
    card = JSON.parse(raw);
  } catch {
    report.push({ name, status: 'unparseable' });
    continue;
  }
  if (!card || typeof card !== 'object' || !card.flow || card.source_refs) {
    report.push({ name, status: card && card.source_refs ? 'already-has-refs' : 'skipped' });
    continue;
  }
  const refs = parseSourceRefs(card.source);
  const empty = !refs.trajectory_ids.length && !refs.tx_nos.length && !refs.dates.length;
  report.push({ name, status: empty ? 'low-confidence' : 'parsed', refs });
  if (!empty && APPLY) {
    const next = { ...card, source_refs: refs };
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  }
}
console.log(JSON.stringify(report, null, 2));
console.log(APPLY ? '[applied] 已写盘' : '[dry-run] 未写盘（加 --apply 生效）');
