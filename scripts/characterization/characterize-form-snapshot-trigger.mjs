/**
 * Lightweight check: form_snapshot.trigger_step_id CASCADE semantics
 * (schema presence + DAO helpers). Does not require a live MySQL if knex fails —
 * then prints SKIP with reason.
 *
 * Usage: node scripts/characterization/characterize-form-snapshot-trigger.mjs
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('OK:', msg);
  }
}

const initSql = readFileSync(path.join(root, 'schemas/init.sql'), 'utf-8');
assert(/trigger_step_id/.test(initSql), 'init.sql has trigger_step_id');
assert(/fk_fs_trigger_step/.test(initSql), 'init.sql has fk_fs_trigger_step');
assert(/uk_fs_trigger_step/.test(initSql), 'init.sql has uk_fs_trigger_step');
assert(
  /CONSTRAINT `fk_fs_trajectory`[\s\S]*ON DELETE CASCADE/.test(initSql),
  'init.sql form_snapshot.trajectory_id ON DELETE CASCADE',
);

const mig = path.join(root, 'migrations/20260804010000_form_snapshot_trigger_step.js');
assert(existsSync(mig), 'migration file exists');

const dao = readFileSync(path.join(root, 'src/dao/form-snapshot-dao.js'), 'utf-8');
assert(/export async function updateFields/.test(dao), 'DAO updateFields');
assert(/export async function findForDedupe/.test(dao), 'DAO findForDedupe');
assert(/triggerStepId/.test(dao), 'DAO persists triggerStepId');

const persist = readFileSync(path.join(root, 'src/services/trajectory/trajectory-persist-service.js'), 'utf-8');
assert(/appendRecordedFormSnapshot/.test(persist), 'persist appendRecordedFormSnapshot');
const fsa = readFileSync(path.join(root, 'src/services/trajectory/form-snapshot-append.js'), 'utf-8');
assert(/save_form_snapshot/.test(fsa), 'persist special-cases save_form_snapshot');

const replay = readFileSync(path.join(root, 'src/services/trajectory/trajectory-session-replay.js'), 'utf-8');
assert(/healType: 'form_structure'/.test(replay) || /healType: \"form_structure\"/.test(replay)
  || /form_structure/.test(replay), 'replay has form_structure heal');
assert(/replay:form_structure/.test(replay), 'emits replay:form_structure');
const fsh = readFileSync(path.join(root, 'src/services/trajectory/form-structure-heal.js'), 'utf-8');
assert(/insertStepsAfter/.test(fsh), 'Type B uses insertStepsAfter');

const formPy = readFileSync(path.join(root, 'scripts/controller/actions/_form.py'), 'utf-8');
const formScanPy = readFileSync(path.join(root, 'scripts/controller/actions/form_scan_utils.py'), 'utf-8');
assert(/emit_checkpoint/.test(formScanPy), 'Python _save_form_snapshot has emit_checkpoint');
// scan_form_fields must not call _save_form_snapshot immediately after container_id
const scanIdx = formPy.indexOf("async def scan_form_fields");
const nextDef = formPy.indexOf('\n    @controller.action', scanIdx + 10);
const scanBody = formPy.slice(scanIdx, nextDef > 0 ? nextDef : scanIdx + 2000);
assert(
  !/_save_form_snapshot\(/.test(scanBody),
  'scan_form_fields does not call _save_form_snapshot',
);

const heal = readFileSync(path.join(root, 'src/routes/browser-session/heal-instruction.js'), 'utf-8');
assert(/buildFormStructureHealInstruction/.test(heal), 'buildFormStructureHealInstruction exists');

assert(
  /safety\.unsafe[\s\S]{0,800}?aborted:\s*false/.test(fsh)
  || /FORM_STRUCTURE_UNSAFE_CONTINUE/.test(fsh),
  'unsafe form-structure path returns aborted: false (P0 continue)',
);
assert(
  !/if \(safety\.unsafe\) \{[\s\S]{0,600}?return \{ ok: false, aborted: true/.test(fsh),
  'unsafe path must not return aborted: true',
);

const runner = readFileSync(
  path.join(root, 'src/services/trajectory/replay-batch-runner.js'),
  'utf-8',
);
assert(
  /!typeB\.ok\s*&&\s*!typeB\.aborted/.test(runner)
  || /FORM_STRUCTURE_SOFT_FAIL_CONTINUE/.test(runner),
  'runner continues on Type B soft-fail (!ok && !aborted)',
);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll form-snapshot trigger characterizations passed.');
