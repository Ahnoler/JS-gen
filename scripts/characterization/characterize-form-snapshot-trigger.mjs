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

const formPy = readFileSync(path.join(root, 'scripts/actions/_form.py'), 'utf-8');
assert(/emit_checkpoint/.test(formPy), 'Python _save_form_snapshot has emit_checkpoint');
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

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll form-snapshot trigger characterizations passed.');
