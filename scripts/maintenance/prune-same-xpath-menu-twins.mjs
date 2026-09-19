/**
 * One-shot maintenance: prune type=3 function nodes that share the same non-empty
 * menu_xpath under the same module (same-pass scan twin bug residue).
 *
 * Keeps one per (moduleId, menu_xpath): prefer non-empty uml_ecd, then pd_cmpt_ecd,
 * then lowest id. Losers' trajectory / batch_recording_job / special_element rows
 * are re-pointed to the keeper before delete.
 *
 * Usage:
 *   node scripts/maintenance/prune-same-xpath-menu-twins.mjs --systemId=1
 *   node scripts/maintenance/prune-same-xpath-menu-twins.mjs --systemId=1 --apply
 */
import { getDB, closeDB } from '../../config/database.js';
import * as systemDao from '../../src/dao/system-dao.js';
import { NODE_TYPE } from '../../src/models/hierarchy-constants.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const systemIdArg = args.find((a) => a.startsWith('--systemId='));
const systemNodeId = systemIdArg ? Number(systemIdArg.split('=')[1]) : NaN;

if (!Number.isFinite(systemNodeId) || systemNodeId <= 0) {
  console.error('Usage: node scripts/maintenance/prune-same-xpath-menu-twins.mjs --systemId=<id> [--apply]');
  process.exit(1);
}

/**
 * @param {object[]} nodes shaped function nodes with identical menuXpath
 * @returns {object} keeper
 */
function pickKeeper(nodes) {
  return [...nodes].sort((a, b) => {
    const umlA = String(a.umlEcd || '').trim() ? 1 : 0;
    const umlB = String(b.umlEcd || '').trim() ? 1 : 0;
    if (umlB !== umlA) return umlB - umlA;
    const pdA = String(a.pdCmptEcd || '').trim() ? 1 : 0;
    const pdB = String(b.pdCmptEcd || '').trim() ? 1 : 0;
    if (pdB !== pdA) return pdB - pdA;
    return Number(a.id) - Number(b.id);
  })[0];
}

/**
 * @param {number} systemId type=1 system node id
 * @param {object|null} trx knex trx
 * @returns {Promise<Array<object>>}
 */
async function planPrunes(systemId, trx = null) {
  const db = trx || getDB();
  const modules = await systemDao.listByParent(systemId, db);
  const plans = [];

  for (const mod of modules) {
    if (Number(mod.type) !== NODE_TYPE.MODULE) continue;
    const kids = await systemDao.listByParent(mod.id, db);
    const fns = kids.filter((k) => Number(k.type) === NODE_TYPE.FUNCTION);
    const byXpath = new Map();
    for (const fn of fns) {
      const xp = String(fn.menuXpath || '').trim();
      if (!xp) continue;
      if (!byXpath.has(xp)) byXpath.set(xp, []);
      byXpath.get(xp).push(fn);
    }

    for (const [menuXpath, group] of byXpath) {
      if (group.length < 2) continue;
      const keeper = pickKeeper(group);
      const losers = group.filter((n) => Number(n.id) !== Number(keeper.id));
      plans.push({
        moduleId: Number(mod.id),
        moduleName: String(mod.name || ''),
        menuXpath,
        keeper,
        losers,
      });
    }
  }
  return plans;
}

/**
 * @param {object} plan prune plan entry
 * @param {object} trx knex transaction
 * @returns {Promise<object>} applied stats
 */
async function applyPrune(plan, trx) {
  const keeperId = Number(plan.keeper.id);
  let trajMoved = 0;
  let batchMoved = 0;
  let seMoved = 0;
  let pagesDeleted = 0;

  for (const loser of plan.losers) {
    const loserId = Number(loser.id);
    trajMoved += Number(
      await trx('trajectory').where({ function_id: loserId }).update({ function_id: keeperId }),
    ) || 0;
    batchMoved += Number(
      await trx('batch_recording_job').where({ function_id: loserId }).update({ function_id: keeperId }),
    ) || 0;
    seMoved += Number(
      await trx('special_element').where({ function_id: loserId }).update({ function_id: keeperId }),
    ) || 0;

    const pageRows = await trx('system_page').where({ system_node_id: loserId }).count('* as c').first();
    pagesDeleted += Number(pageRows?.c) || 0;
    await trx('system').where({ id: loserId }).del();
  }

  return {
    keeperId,
    loserIds: plan.losers.map((n) => Number(n.id)),
    trajMoved,
    batchMoved,
    seMoved,
    pagesDeleted,
  };
}

/**
 * @param {Array<object>} plans
 */
function printPlan(plans) {
  if (!plans.length) {
    console.log('No same-xpath twin groups found.');
    return;
  }
  console.log(`Found ${plans.length} same-xpath twin group(s):\n`);
  for (const p of plans) {
    const k = p.keeper;
    const loserDesc = p.losers
      .map((n) => `id=${n.id} name="${n.name}" uml=${n.umlEcd || ''} pd=${n.pdCmptEcd || ''}`)
      .join('; ');
    console.log(
      `  [${p.moduleName}] xpath=${p.menuXpath.slice(0, 80)}${p.menuXpath.length > 80 ? '…' : ''}`,
    );
    console.log(
      `    KEEP id=${k.id} name="${k.name}" uml=${k.umlEcd || ''} pd=${k.pdCmptEcd || ''}`,
    );
    console.log(`    DROP ${loserDesc}`);
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

    const plans = await planPrunes(systemNodeId);
    printPlan(plans);

    if (!apply) {
      console.log('\nDry-run only — pass --apply to write.');
      return;
    }

    if (!plans.length) return;

    const results = [];
    await db.transaction(async (trx) => {
      for (const plan of plans) {
        const r = await applyPrune(plan, trx);
        results.push({ ...plan, ...r });
        console.log(
          `\nApplied: keep ${r.keeperId} drop [${r.loserIds.join(',')}]`
            + ` | traj=${r.trajMoved} batch=${r.batchMoved} se=${r.seMoved} pages_deleted=${r.pagesDeleted}`,
        );
      }
    });
    console.log(`\nDone: ${results.length} group(s) pruned.`);
  } finally {
    await closeDB();
  }
}

main().catch((err) => {
  console.error('BLOCKED:', err.message || err);
  process.exit(1);
});
