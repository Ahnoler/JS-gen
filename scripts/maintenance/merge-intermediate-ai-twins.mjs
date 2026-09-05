/**
 * One-shot maintenance: merge intermediate json_import twins with navigable AI twins.
 *
 * Usage:
 *   node scripts/maintenance/merge-intermediate-ai-twins.mjs --systemId=1          # dry-run
 *   node scripts/maintenance/merge-intermediate-ai-twins.mjs --systemId=1 --apply  # write
 */
import { getDB, closeDB } from '../../config/database.js';
import * as systemDao from '../../src/dao/system-dao.js';
import { NODE_TYPE } from '../../src/models/hierarchy-constants.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const systemIdArg = args.find((a) => a.startsWith('--systemId='));
const systemNodeId = systemIdArg ? Number(systemIdArg.split('=')[1]) : NaN;

if (!Number.isFinite(systemNodeId) || systemNodeId <= 0) {
  console.error('Usage: node scripts/maintenance/merge-intermediate-ai-twins.mjs --systemId=<id> [--apply]');
  process.exit(1);
}

/**
 * @param {object[]} nodes shaped function nodes
 * @returns {object[]} intermediate candidates (prefer json_import, then lowest id)
 */
function pickIntermediateTarget(nodes) {
  const inter = nodes.filter((n) => Number(n.intermediateFlag) === 1);
  if (!inter.length) return null;
  const json = inter.filter((n) => String(n.source || '').trim() === 'json_import');
  const pool = json.length ? json : inter;
  return [...pool].sort((a, b) => Number(a.id) - Number(b.id))[0];
}

/**
 * @param {object[]} nodes shaped function nodes excluding target A
 * @returns {object|null} navigable twin to absorb (prefer menuXpath, then ai, then highest id)
 */
function pickNavigableSource(nodes, targetId) {
  const nav = nodes.filter(
    (n) => Number(n.intermediateFlag) !== 1 && Number(n.id) !== Number(targetId),
  );
  if (!nav.length) return null;
  const withXpath = nav.filter((n) => String(n.menuXpath || '').trim());
  const pool = withXpath.length ? withXpath : nav;
  return [...pool].sort((a, b) => {
    const aiA = String(a.source || '').trim() === 'ai' ? 1 : 0;
    const aiB = String(b.source || '').trim() === 'ai' ? 1 : 0;
    if (aiB !== aiA) return aiB - aiA;
    return Number(b.id) - Number(a.id);
  })[0];
}

/**
 * @param {number} systemId type=1 system node id
 * @param {object|null} trx knex trx
 * @returns {Promise<Array<{ moduleId: number, moduleName: string, name: string, target: object, source: object }>>}
 */
async function planMerges(systemId, trx = null) {
  const db = trx || getDB();
  const modules = await systemDao.listByParent(systemId, db);
  const plans = [];

  for (const mod of modules) {
    if (Number(mod.type) !== NODE_TYPE.MODULE) continue;
    const kids = await systemDao.listByParent(mod.id, db);
    const fns = kids.filter((k) => Number(k.type) === NODE_TYPE.FUNCTION);
    const byName = new Map();
    for (const fn of fns) {
      const key = String(fn.name || '').trim();
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(fn);
    }

    for (const [name, group] of byName) {
      const hasInter = group.some((n) => Number(n.intermediateFlag) === 1);
      const hasNav = group.some((n) => Number(n.intermediateFlag) !== 1);
      if (!hasInter || !hasNav) continue;

      const target = pickIntermediateTarget(group);
      const source = pickNavigableSource(group, target?.id);
      if (!target || !source) continue;

      plans.push({
        moduleId: Number(mod.id),
        moduleName: String(mod.name || ''),
        name,
        target,
        source,
      });
    }
  }
  return plans;
}

/**
 * @param {object} plan merge plan entry
 * @param {object} trx knex transaction
 * @returns {Promise<object>} applied stats
 */
async function applyMerge(plan, trx) {
  const targetId = Number(plan.target.id);
  const sourceId = Number(plan.source.id);
  const targetRaw = await systemDao.getRawById(targetId, trx);
  const sourceRaw = await systemDao.getRawById(sourceId, trx);
  if (!targetRaw || !sourceRaw) {
    throw new Error(`Missing node during merge ${sourceId} → ${targetId}`);
  }

  const trajMoved = await trx('trajectory')
    .where({ function_id: sourceId })
    .update({ function_id: targetId });

  const batchMoved = await trx('batch_recording_job')
    .where({ function_id: sourceId })
    .update({ function_id: targetId });

  const seMoved = await trx('special_element')
    .where({ function_id: sourceId })
    .update({ function_id: targetId });

  const patch = {
    intermediateFlag: 0,
    unmatchedFlag: 0,
  };
  if (!String(targetRaw.menuXpath || '').trim() && String(sourceRaw.menuXpath || '').trim()) {
    patch.menuXpath = String(sourceRaw.menuXpath || '').trim();
  }
  if (!String(targetRaw.pdCmptEcd || '').trim() && String(sourceRaw.pdCmptEcd || '').trim()) {
    patch.pdCmptEcd = String(sourceRaw.pdCmptEcd || '').trim();
  }
  await systemDao.update(targetId, patch, trx);

  const pageRows = await trx('system_page').where({ system_node_id: sourceId }).count('* as c').first();
  await trx('system').where({ id: sourceId }).del();

  return {
    targetId,
    sourceId,
    trajMoved: Number(trajMoved) || 0,
    batchMoved: Number(batchMoved) || 0,
    seMoved: Number(seMoved) || 0,
    pagesDeleted: Number(pageRows?.c) || 0,
    patch,
  };
}

function printPlan(plans) {
  if (!plans.length) {
    console.log('No intermediate/navigable twin pairs found.');
    return;
  }
  console.log(`Found ${plans.length} merge pair(s):\n`);
  for (const p of plans) {
    const t = p.target;
    const s = p.source;
    console.log(
      `  [${p.moduleName}] "${p.name}": B id=${s.id} (${s.source}, intermediate=${s.intermediateFlag}, xpath=${s.menuXpath ? 'yes' : 'no'})`
      + ` → A id=${t.id} (${t.source}, intermediate=${t.intermediateFlag}, uml=${t.umlEcd || ''})`,
    );
  }
}

async function main() {
  const db = getDB();
  try {
    const sys = await systemDao.getById(systemNodeId);
    if (!sys || Number(sys.type) !== NODE_TYPE.SYSTEM) {
      throw new Error(`systemId=${systemNodeId} is not a type=1 system node`);
    }
    console.log(`System: id=${sys.id} name="${sys.name}" mode=${apply ? 'APPLY' : 'DRY-RUN'}\n`);

    const plans = await planMerges(systemNodeId);
    printPlan(plans);

    if (!apply) {
      console.log('\nDry-run only — pass --apply to write.');
      return;
    }

    if (!plans.length) return;

    const results = [];
    await db.transaction(async (trx) => {
      for (const plan of plans) {
        const r = await applyMerge(plan, trx);
        results.push({ ...plan, ...r });
        console.log(
          `\nApplied: B ${r.sourceId} → A ${r.targetId} | traj=${r.trajMoved} batch=${r.batchMoved} se=${r.seMoved} pages_deleted=${r.pagesDeleted}`,
        );
      }
    });
    console.log(`\nDone: ${results.length} merge(s) applied.`);
  } finally {
    await closeDB();
  }
}

main().catch((err) => {
  console.error('BLOCKED:', err.message || err);
  process.exit(1);
});
