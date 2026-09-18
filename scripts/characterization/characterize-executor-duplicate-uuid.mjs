import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Pin: B-3 executor same-uuid zombie twin — three residual gaps fixed (spec
// docs/superpowers/specs/2026-09-18-engine-pipeline-b123-fix-design.md §三):
//   c-1 agent close 4001 → self-kill exit(2) (no immortal half-open reconnect loop)
//   c-2 structured rejection code 'duplicate_node_uuid' on both sides (registry payload + client recognition)
//   c-3 401 (EXECUTOR_TOKEN misconfig) counted → 5 consecutive → exit(3); network errors never count
//   a  startup lock moved to os.tmpdir()/js-gen-executor-<uuid8>.lock (mutual exclusion across checkouts)
//   b  server attaches (validates) before DB upsert — rejected registration no longer fakes DB online

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
let failures = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); } else { failures += 1; console.error(`  ✗ ${msg}`); }
}

const wsClientSrc = readFileSync(join(ROOT, 'executor', 'ws-client.js'), 'utf-8');
const configSrc = readFileSync(join(ROOT, 'executor', 'config.js'), 'utf-8');
const registrySrc = readFileSync(join(ROOT, 'src', 'executor-registry.js'), 'utf-8');
const executorWsSrc = readFileSync(join(ROOT, 'src', 'executor-ws.js'), 'utf-8');

// --- c-1: ws-client close handler branches on 4001 and exits(2) ---
check(wsClientSrc.includes('code === 4001'), 'ws-client close handler has a dedicated close-code 4001 branch');
check(wsClientSrc.includes('process.exit(2)'), 'ws-client duplicate-uuid path exits the process with code 2');
check(
  wsClientSrc.includes('✖ duplicate node uuid — another live executor owns this uuid, exiting'),
  'ws-client prints single-line duplicate-uuid fatal message before exit',
);

// --- c-2: structured duplicate_node_uuid signal, both sides ---
check(
  wsClientSrc.includes("payload?.code === 'duplicate_node_uuid'"),
  'ws-client executor.error handler recognizes structured code duplicate_node_uuid (belt-and-braces with close 4001)',
);
check(
  registrySrc.includes("code: 'duplicate_node_uuid'"),
  'registry rejection executor.error payload carries code duplicate_node_uuid',
);

// --- c-3: 401 counted, 5 consecutive → exit(3), network errors reset the streak ---
check(
  wsClientSrc.includes('Unexpected server response: 401'),
  'ws-client ws error handler detects upgrade rejection 401 by message',
);
check(wsClientSrc.includes('process.exit(3)'), 'ws-client 5 consecutive 401s exit the process with code 3');
check(
  wsClientSrc.includes('this.authFailCount >= 5'),
  'ws-client 401 streak threshold is exactly 5 consecutive failures',
);
check(
  (wsClientSrc.match(/this\.authFailCount = 0;/g) || []).length >= 2,
  'ws-client 401 streak counter initialized and reset by non-401 (network) errors',
);
check(
  wsClientSrc.includes('EXECUTOR_TOKEN'),
  'ws-client 401 fatal message names EXECUTOR_TOKEN as the misconfigured setting',
);

// --- a: lock path shared across checkouts via os.tmpdir, namespaced by uuid prefix ---
check(configSrc.includes('os.tmpdir()'), 'executor lock file lives under os.tmpdir() (not per-checkout EXECUTOR_DIR)');
check(
  configSrc.includes('js-gen-executor-'),
  'executor lock file name uses js-gen-executor- prefix',
);
check(
  configSrc.includes('EXECUTOR_NODE_UUID.slice(0, 8)'),
  'executor lock file namespaced by first 8 chars of the resolved node uuid',
);

// --- b: executor-ws attaches (validates) BEFORE DB register/upsert; rejection returns before upsert ---
const attachIdx = executorWsSrc.indexOf('registry.attach(');
const dbRegisterIdx = executorWsSrc.indexOf('executorService.register(');
const rejectWarnIdx = executorWsSrc.indexOf('register rejected for');
check(attachIdx !== -1 && dbRegisterIdx !== -1 && attachIdx < dbRegisterIdx,
  'executor-ws registry.attach validation precedes executorService.register DB upsert');
check(attachIdx !== -1 && rejectWarnIdx !== -1 && rejectWarnIdx < dbRegisterIdx,
  'executor-ws duplicate-process rejection early-returns before the DB upsert');

if (failures) { console.error(`FAIL: ${failures} assertion(s) failed`); process.exit(1); }
console.log('characterize-executor-duplicate-uuid: OK');
