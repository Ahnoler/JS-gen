/**
 * Smoke: P2-4 multi-model compare report.
 *
 * Creates two trajectories (different models) with overlapping + divergent
 * form-value facts (llm/page sources), then asserts compareModels output.
 *
 * Prerequisites:
 *   npx knex migrate:latest --knexfile config/knexfile.js
 *
 * Usage: node scripts/smoke/smoke-memory-compare.mjs
 */
import { getDB } from '../../config/database.js';
import { ingestEvents, compareModels } from '../../src/memory/memory-service.js';
import { isReady } from '../../src/memory/memory-dao.js';

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

async function main() {
  console.log('[smoke] memory compare (P2-4) — schema ready?');
  if (!(await isReady())) {
    fail('schema-ready', 'run migration first');
    process.exitCode = 1;
    await getDB().destroy();
    return;
  }
  pass('schema-ready');

  const db = getDB();
  let fid = 1;
  const sys = await db('system').where({ type: 3 }).first();
  if (sys) fid = Number(sys.id);

  let tA = null;
  let tB = null;
  try {
    [tA] = await db('trajectory').insert({
      task: 'P2-4 smoke compare A',
      function_id: fid,
      model: 'deepseek-chat',
      is_successful: 1,
      is_done: 1,
      step_count: 10,
      phase_count: 2,
    });
    [tB] = await db('trajectory').insert({
      task: 'P2-4 smoke compare B',
      function_id: fid,
      model: 'gpt-4o-mini',
      is_successful: 1,
      is_done: 1,
      step_count: 14,
      phase_count: 2,
    });
    pass('setup.trajectories', `A=${tA} B=${tB}`);

    // A: 客户名称+联系人 (llm/page)；requirement 不应进入 formValues
    await ingestEvents({
      events: [
        {
          eventType: 'decision',
          trajectoryId: tA,
          sessionId: 'smoke-compare-a',
          model: 'deepseek-chat',
          payload: { kind: 'form_value' },
          facts: [
            { entity: '客户名称', attribute: 'value', value: '恒通商贸', source: 'llm', stance: 'inferred' },
            { entity: '联系人', attribute: 'value', value: '张三', source: 'page', stance: 'neutral' },
            { entity: '证件号码', attribute: 'value', value: 'REQ-SHOULD-IGNORE', source: 'requirement', stance: 'authoritative' },
          ],
          decision: {
            decisionType: 'form_value',
            model: 'deepseek-chat',
            auditStatus: 'passed',
            outputJson: { ok: true },
          },
        },
      ],
    });

    // B: 客户名称一致；联系人不同；多一个证件号码(page) → 并集缺字段惩罚 A
    await ingestEvents({
      events: [
        {
          eventType: 'decision',
          trajectoryId: tB,
          sessionId: 'smoke-compare-b',
          model: 'gpt-4o-mini',
          payload: { kind: 'form_value' },
          facts: [
            { entity: '客户名称', attribute: 'value', value: '恒通商贸', source: 'llm', stance: 'inferred' },
            { entity: '联系人', attribute: 'value', value: '李四', source: 'page', stance: 'neutral' },
            { entity: '证件号码', attribute: 'value', value: '91440101TEST', source: 'page', stance: 'neutral' },
          ],
          decision: {
            decisionType: 'form_value',
            model: 'gpt-4o-mini',
            auditStatus: 'passed',
            outputJson: { ok: true },
          },
        },
      ],
    });
    pass('setup.facts-decisions');

    const empty = await compareModels({ trajectoryIds: [] });
    check('empty.400', empty.status === 400, `status=${empty.status}`);

    const missing = await compareModels({ trajectoryIds: [999999901, 999999902] });
    check('all-missing.404', missing.status === 404, `status=${missing.status}`);

    const single = await compareModels({ trajectoryIds: [tA, 999999903] });
    check('single.200', !single.status && single.trajectories?.length === 1, `len=${single.trajectories?.length}`);
    check('single.consistency-null', single.consistency === null, `consistency=${single.consistency}`);
    check('single.missingIds', Array.isArray(single.missingIds) && single.missingIds.includes(999999903), `missing=${JSON.stringify(single.missingIds)}`);

    const report = await compareModels({ trajectoryIds: [tA, tB] });
    check('compare.len', report.trajectories?.length === 2, `len=${report.trajectories?.length}`);
    check(
      'compare.models',
      report.trajectories?.[0]?.model === 'deepseek-chat' && report.trajectories?.[1]?.model === 'gpt-4o-mini',
      report.trajectories?.map((t) => t.model).join(','),
    );
    check(
      'compare.passRate',
      Number.isFinite(report.trajectories?.[0]?.decisions?.passRate),
      `passRateA=${report.trajectories?.[0]?.decisions?.passRate}`,
    );
    const fvA = report.trajectories?.[0]?.formValues || {};
    const fvB = report.trajectories?.[1]?.formValues || {};
    check('formValues.exclude-requirement', fvA['证件号码'] === undefined, `A证件=${fvA['证件号码']}`);
    check('formValues.A-keys', fvA['客户名称'] === '恒通商贸' && fvA['联系人'] === '张三', JSON.stringify(fvA));
    check('formValues.B-has-id', fvB['证件号码'] === '91440101TEST', `B证件=${fvB['证件号码']}`);

    const c = report.consistency;
    check('consistency.present', c && c.entitiesCompared === 3, `entitiesCompared=${c?.entitiesCompared}`);
    // 并集 3：客户名称一致；联系人不同；证件号码仅 B → exactMatch=1/3
    check('consistency.exactMatchRate', c?.exactMatchRate === 0.3333, `exactMatchRate=${c?.exactMatchRate}`);
    check(
      'consistency.pairwise',
      Array.isArray(c?.pairwise) && c.pairwise.length === 1 && c.pairwise[0].compared === 3,
      JSON.stringify(c?.pairwise),
    );
    // pairwise: only 客户名称 matches → 1/3
    check('consistency.pairwise-rate', c?.pairwise?.[0]?.matchRate === 0.3333, `matchRate=${c?.pairwise?.[0]?.matchRate}`);
  } finally {
    console.log('[smoke] cleanup');
    if (tA != null || tB != null) {
      const ids = [tA, tB].filter((x) => x != null);
      await db('memory_relation').whereIn('trajectory_id', ids).delete();
      await db('decision_record').whereIn('trajectory_id', ids).delete();
      await db('memory_fact').whereIn('trajectory_id', ids).delete();
      await db('memory_event').whereIn('trajectory_id', ids).delete();
      await db('trajectory').whereIn('id', ids).delete();
      pass('cleanup', ids.join(','));
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
