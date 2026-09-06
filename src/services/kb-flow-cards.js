/**
 * KB 流程卡只读器：Node 控制面对 data/kb/flows/*.json 的单向只读面（方案甲）。
 * 不写 KB、不 import Python 侧；容错语义与 scripts/kb/store.py load_flows 对齐：
 * 目录缺失→空数组；单卡 JSON 损坏/非 dict/缺 flow 键→跳过并 warn。
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_FLOWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'kb', 'flows');

/**
 * 列出全部流程卡的消费侧字段（按文件名排序，确定性）。
 * @param {{ dir?: string }} [opts] 可注入目录（特征化用）；缺省=仓库 data/kb/flows
 * @returns {Promise<Array<{flow: string, menu_path: string, source: unknown, source_refs: object|undefined}>>} 卡片列表（仅消费侧字段）
 */
export async function listFlowCards({ dir = DEFAULT_FLOWS_DIR } = {}) {
  let names;
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const cards = [];
  for (const name of names) {
    let card;
    try {
      card = JSON.parse(await readFile(join(dir, name), 'utf-8'));
    } catch (e) {
      console.warn(`[kb-flow-cards] skip unparseable card: ${name} (${e.message})`);
      continue;
    }
    if (!card || typeof card !== 'object' || !card.flow) {
      console.warn(`[kb-flow-cards] skip card missing flow key: ${name}`);
      continue;
    }
    cards.push({
      flow: String(card.flow),
      menu_path: card.menu_path == null ? '' : String(card.menu_path),
      source: card.source ?? null,
      ...(card.source_refs != null ? { source_refs: card.source_refs } : {}),
    });
  }
  return cards;
}
