/**
 * Smoke: memory core tables ingest → retrieve → audit → stats → cleanup.
 *
 * Inserts sample events (+ facts + decision) through memory-service.ingestEvents,
 * verifies fact-pack retrieval / decision detail / audit summary / timeline /
 * global stats, then removes the test trajectory via deleteByTrajectory.
 *
 * Prerequisites:
 *   npx knex migrate:latest --knexfile config/knexfile.js   (MySQL up)
 *
 * Usage: node scripts/smoke/smoke-memory-ingest.mjs
 */
import {
  ingestEvents,
  retrieveFactPack,
  listDecisions,
  getDecision,
  auditSummary,
  runAudit,
  timeline,
  stats,
} from '../../src/memory/memory-service.js';
import { deleteByTrajectory, isReady } from '../../src/memory/memory-dao.js';
import { getDB } from '../../config/database.js';

const TRAJ = 99990001; // test-only trajectory id (cleaned up at the end)

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
  console.log('[smoke] memory ingest — schema ready?');
  if (!(await isReady())) {
    fail('schema-ready', 'run migration first: npx knex migrate:latest --knexfile config/knexfile.js');
    return;
  }
  pass('schema-ready', '4 memory tables exist');

  console.log('[smoke] ingest 3 events (case_saved + phase_done + decision)');
  const ingest = await ingestEvents({
    events: [
      {
        eventType: 'case_saved',
        trajectoryId: TRAJ,
        phaseNumber: 1,
        stepNumber: 3,
        source: 'agent',
        model: 'smoke-model',
        payload: { key: '客户名称', value: '恒通商贸有限公司' },
        facts: [
          {
            entity: '客户名称',
            attribute: 'value',
            value: '恒通商贸有限公司',
            source: 'rule',
            stance: 'authoritative',
            factType: 'case_value',
          },
          {
            entity: '模型名称',
            attribute: 'value',
            value: '批发和零售业评分模型',
            source: 'agent',
            stance: 'neutral',
            factType: 'page_state',
          },
        ],
      },
      {
        eventType: 'phase_done',
        trajectoryId: TRAJ,
        phaseNumber: 1,
        source: 'agent',
        model: 'smoke-model',
        payload: { success: true, text: '对公客户评级申请完成' },
        facts: [
          {
            entity: 'phase_1',
            attribute: 'outcome',
            value: 'success',
            source: 'system',
            stance: 'authoritative',
            factType: 'outcome',
          },
        ],
      },
      {
        eventType: 'decision',
        trajectoryId: TRAJ,
        phaseNumber: 1,
        stepNumber: 5,
        source: 'agent',
        model: 'smoke-model',
        decision: {
          decisionType: 'form_value',
          model: 'smoke-model',
          temperature: 0.2,
          inputFactIds: [1, 2],
          inputPreview: 'select_option 模型名称/first',
          outputJson: { action: 'select_option', params: { label_text: '模型名称', option_text: 'first' } },
          policyChecks: [
            { check: 'contract-match', pass: true },
            { check: 'fact-reference', pass: true },
          ],
          overridden: false,
          auditStatus: 'passed',
        },
      },
    ],
  });
  check('ingest.inserted', ingest.inserted === 3, `inserted=${ingest.inserted}`);
  check('ingest.facts', ingest.facts === 3, `facts=${ingest.facts}`);
  check('ingest.decisions', ingest.decisions === 1, `decisions=${ingest.decisions}`);
  check('ingest.relations', ingest.relations === 1, `relations=${ingest.relations}`);

  console.log('[smoke] fact pack retrieval');
  const pack = await retrieveFactPack({ trajectoryId: TRAJ, entity: '客户名称', maxChars: 2000 });
  check('retrieve.byEntity', pack.facts.length === 1, `facts=${pack.facts.length}`);
  const hit = pack.facts[0];
  check(
    'retrieve.value',
    hit?.entity === '客户名称' && hit?.value === '恒通商贸有限公司',
    hit ? `${hit.entity}=${hit.value} (source=${hit.source}, stance=${hit.stance}, weight=${hit.weight})` : 'no fact',
  );
  check('retrieve.stance', hit?.stance === 'authoritative', `stance=${hit?.stance}`);
  check('retrieve.budget', Number.isFinite(pack.budget?.used) && Number.isFinite(pack.budget?.max), 'budget present');

  console.log('[smoke] decisions + audit');
  const decisions = await listDecisions({ trajectoryId: TRAJ });
  check('decisions.list', decisions.length === 1, `count=${decisions.length}`);
  const dec = decisions[0];
  check('decisions.auditStatus', dec?.auditStatus === 'passed', `auditStatus=${dec?.auditStatus}`);
  const detail = await getDecision(dec?.id);
  check(
    'decisions.detail',
    detail?.decisionType === 'form_value' && detail?.model === 'smoke-model',
    `type=${detail?.decisionType} model=${detail?.model}`,
  );
  check('decisions.policyChecks', Array.isArray(detail?.policyChecks) && detail.policyChecks.length === 2, 'policyChecks=2');

  const audit = await auditSummary(TRAJ);
  check('audit.summary.total', audit.total === 1, `total=${audit.total}`);
  check('audit.summary.passed', audit.byStatus.passed === 1, `byStatus=${JSON.stringify(audit.byStatus)}`);
  const rerun = await runAudit(TRAJ);
  check('audit.rerun', rerun.total === 1 && rerun.mode === 'summary-only', `mode=${rerun.mode}`);

  console.log('[smoke] timeline');
  const tl = await timeline(TRAJ);
  check('timeline.events', tl.events.length === 3, `events=${tl.events.length}`);
  check('timeline.facts', tl.facts.length === 3, `facts=${tl.facts.length}`);
  check('timeline.decisions', tl.decisions.length === 1, `decisions=${tl.decisions.length}`);

  console.log('[smoke] global stats');
  const st = await stats();
  check(
    'stats.tables',
    st.tables?.memoryEvent >= 3 && st.tables?.memoryFact >= 3 && st.tables?.decisionRecord >= 1,
    `tables=${JSON.stringify(st.tables)}`,
  );
  check('stats.recentEventTypes', Array.isArray(st.recentEventTypes), 'event-type breakdown present');

  console.log('[smoke] cleanup');
  const removed = await deleteByTrajectory(TRAJ);
  check('cleanup.removed', removed >= 7, `removed=${removed} (3 events + 3 facts + 1 decision)`);
  const after = await timeline(TRAJ);
  check(
    'cleanup.verified',
    after.events.length === 0 && after.facts.length === 0 && after.decisions.length === 0,
    'trajectory memory empty',
  );

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n[smoke] ${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
  await getDB().destroy(); // 释放连接池，否则进程挂住不退出
}

main().catch((e) => {
  console.error('[smoke] fatal:', e);
  process.exitCode = 1;
});
