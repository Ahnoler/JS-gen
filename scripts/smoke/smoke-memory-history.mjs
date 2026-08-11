/**
 * Smoke: P2-2 cross-trajectory history facts in Fact Pack.
 *
 * Creates two trajectories under the same function_id:
 *   T1 = is_successful=1 + page fact
 *   T2 = current recording + requirement fact
 *
 * Verifies three states (AI_MEMORY_HISTORY is a static config snapshot —
 * child processes with env override are required):
 *   1) no functionId          → no history facts
 *   2) HISTORY=true + fid     → history facts present (source=history, stance=inferred),
 *                               requirement still ranks first
 *   3) HISTORY=false + fid    → no history facts
 *
 * Prerequisites:
 *   npx knex migrate:latest --knexfile config/knexfile.js
 *
 * Usage: node scripts/smoke/smoke-memory-history.mjs
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getDB } from '../../config/database.js';
import { ingestEvents, retrieveFactPack } from '../../src/memory/memory-service.js';
import { isReady } from '../../src/memory/memory-dao.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const results = [];

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

function check(name, cond, detail = '') {
  if (cond) pass(name, detail);
  else fail(name, detail);
}

/** Child: import config AFTER env is set, then retrieveFactPack. */
function childRetrieve({ historyOn, trajectoryId, functionId }) {
  // Relative imports (cwd=ROOT) — Windows cannot `import('D:/...')` without file://
  const script = `
    const { retrieveFactPack } = await import('./src/memory/memory-service.js');
    const { getDB } = await import('./config/database.js');
    const pack = await retrieveFactPack({
      trajectoryId: ${Number(trajectoryId)},
      functionId: ${functionId == null ? 'null' : Number(functionId)},
      maxChars: 2000,
    });
    const slim = (pack.facts || []).map((f) => ({
      entity: f.entity,
      source: f.source,
      stance: f.stance,
      value: f.value,
      effectiveWeight: f.effectiveWeight,
    }));
    process.stdout.write(JSON.stringify({ facts: slim, budget: pack.budget }));
    await getDB().destroy();
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      AI_MEMORY_HISTORY: historyOn ? 'true' : 'false',
    },
  });
  if (r.status !== 0) {
    throw new Error(`child failed (history=${historyOn}): ${r.stderr || r.stdout || r.status}`);
  }
  const out = (r.stdout || '').trim();
  const lastLine = out.split(/\r?\n/).filter(Boolean).pop() || '{}';
  return JSON.parse(lastLine);
}

async function main() {
  console.log('[smoke] memory history (P2-2) — schema ready?');
  if (!(await isReady())) {
    fail('schema-ready', 'run migration first: npx knex migrate:latest --knexfile config/knexfile.js');
    process.exitCode = 1;
    await getDB().destroy();
    return;
  }
  pass('schema-ready');

  const db = getDB();
  let fid = 1;
  const sys = await db('system').where({ type: 3 }).first();
  if (sys) fid = Number(sys.id);
  pass('function-node', `functionId=${fid}`);

  let t1 = null;
  let t2 = null;
  try {
    [t1] = await db('trajectory').insert({
      task: 'P2-2 smoke history T1',
      function_id: fid,
      is_successful: 1,
      model: 'smoke',
    });
    [t2] = await db('trajectory').insert({
      task: 'P2-2 smoke history T2',
      function_id: fid,
      is_successful: null,
      model: 'smoke',
    });
    pass('setup.trajectories', `t1=${t1} (successful) t2=${t2} (current)`);

    const ingest1 = await ingestEvents({
      events: [{
        eventType: 'case_saved',
        trajectoryId: t1,
        sessionId: 'smoke-history-t1',
        payload: { key: '历史联系人' },
        facts: [{
          entity: '历史联系人',
          attribute: 'value',
          value: '张三(历史)',
          source: 'page',
          stance: 'inferred',
          factType: 'case_value',
        }],
      }],
    });
    check('setup.t1-facts', ingest1.facts >= 1, `facts=${ingest1.facts}`);

    const ingest2 = await ingestEvents({
      events: [{
        eventType: 'system',
        trajectoryId: t2,
        sessionId: 'smoke-history-t2',
        source: 'requirement',
        payload: { kind: 'case_entries' },
        facts: [{
          entity: '客户名称',
          attribute: 'value',
          value: '本交易公司',
          source: 'requirement',
          stance: 'authoritative',
          factType: 'requirement',
        }],
      }],
    });
    check('setup.t2-facts', ingest2.facts >= 1, `facts=${ingest2.facts}`);

    // State 1: parent process (HISTORY default false) — no functionId
    console.log('[smoke] state1: no functionId (parent, HISTORY default)');
    const pack1 = await retrieveFactPack({ trajectoryId: t2, maxChars: 2000 });
    const hist1 = (pack1.facts || []).filter((f) => f.source === 'history');
    check('state1.no-history', hist1.length === 0, `facts=${pack1.facts.length} history=${hist1.length}`);
    check(
      'state1.has-requirement',
      pack1.facts.some((f) => f.entity === '客户名称' && f.source === 'requirement'),
      'requirement present',
    );

    // State 2: child with AI_MEMORY_HISTORY=true + functionId
    console.log('[smoke] state2: HISTORY=true + functionId (child process)');
    const pack2 = childRetrieve({ historyOn: true, trajectoryId: t2, functionId: fid });
    const hist2 = (pack2.facts || []).filter((f) => f.source === 'history');
    check('state2.has-history', hist2.length >= 1, `history=${hist2.length} total=${pack2.facts.length}`);
    const histHit = hist2.find((f) => f.entity === '历史联系人');
    check(
      'state2.history-meta',
      histHit?.stance === 'inferred' && histHit?.value === '张三(历史)',
      histHit ? `stance=${histHit.stance} value=${histHit.value}` : 'missing',
    );
    const reqIdx = pack2.facts.findIndex((f) => f.source === 'requirement');
    const histIdx = pack2.facts.findIndex((f) => f.source === 'history');
    check(
      'state2.requirement-ranks-first',
      reqIdx >= 0 && (histIdx < 0 || reqIdx < histIdx),
      `reqIdx=${reqIdx} histIdx=${histIdx}`,
    );

    // State 3: child with AI_MEMORY_HISTORY=false + functionId
    console.log('[smoke] state3: HISTORY=false + functionId (child process)');
    const pack3 = childRetrieve({ historyOn: false, trajectoryId: t2, functionId: fid });
    const hist3 = (pack3.facts || []).filter((f) => f.source === 'history');
    check('state3.no-history', hist3.length === 0, `history=${hist3.length} total=${pack3.facts.length}`);
  } finally {
    console.log('[smoke] cleanup');
    if (t1 != null || t2 != null) {
      const ids = [t1, t2].filter((x) => x != null);
      await db('memory_relation').whereIn('trajectory_id', ids).delete();
      await db('decision_record').whereIn('trajectory_id', ids).delete();
      await db('memory_fact').whereIn('trajectory_id', ids).delete();
      await db('memory_event').whereIn('trajectory_id', ids).delete();
      await db('trajectory').whereIn('id', ids).delete();
      pass('cleanup', `removed traj ${ids.join(',')}`);
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n[smoke] ${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
  await getDB().destroy();
}

main().catch(async (e) => {
  console.error('[smoke] fatal:', e);
  process.exitCode = 1;
  try { await getDB().destroy(); } catch { /* ignore */ }
});
