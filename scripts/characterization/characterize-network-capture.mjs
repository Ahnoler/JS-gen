/**
 * Characterization: network capture persistence wiring (Task 9).
 *
 * Offline, no DB. Asserts:
 *  - protocol.js KNOWN_EVENT_TYPES contains 'network_captured'
 *  - system-ref-dao.js exports findByUrlPattern (function)
 *  - system-ref-service.js exports persistCapturedInterface (function)
 *  - memory-service.js source contains the network_captured persist branch
 *  - session_runner.py source wires attach_network_capture + _net_cleanup
 *  - network_capture.py really imports under the portable Python and
 *    _normalize_url collapses numeric path segments to {id}
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

let count = 0;
function ok(msg) {
  count += 1;
  console.log(`  ok ${count} - ${msg}`);
}

// 1. protocol.js: KNOWN_EVENT_TYPES includes 'network_captured'
const { KNOWN_EVENT_TYPES } = await import('../../src/memory/protocol.js');
assert(KNOWN_EVENT_TYPES instanceof Set, 'KNOWN_EVENT_TYPES is a Set');
assert(KNOWN_EVENT_TYPES.has('network_captured'), "KNOWN_EVENT_TYPES contains 'network_captured'");
ok("KNOWN_EVENT_TYPES contains 'network_captured'");

// 2. dao/service exports
const systemRefDao = await import('../../src/dao/system-ref-dao.js');
assert(typeof systemRefDao.findByUrlPattern === 'function', 'system-ref-dao exports findByUrlPattern');
ok('system-ref-dao.js exports findByUrlPattern (function)');

const systemRefService = await import('../../src/services/system-ref-service.js');
assert(
  typeof systemRefService.persistCapturedInterface === 'function',
  'system-ref-service exports persistCapturedInterface',
);
ok('system-ref-service.js exports persistCapturedInterface (function)');

// 3. memory-service.js source contains the network_captured branch
const memoryServiceSrc = readFileSync(
  path.join(ROOT, 'src', 'memory', 'memory-service.js'),
  'utf8',
);
assert(
  memoryServiceSrc.includes("event.eventType === 'network_captured'"),
  "memory-service.js ingestEvents has a network_captured branch",
);
assert(
  memoryServiceSrc.includes("persistCapturedInterface"),
  'memory-service.js calls persistCapturedInterface',
);
ok('memory-service.js contains network_captured persist branch');

// 4. session_runner.py source wiring
const sessionRunnerSrc = readFileSync(
  path.join(ROOT, 'scripts', 'session_runner.py'),
  'utf8',
);
assert(
  sessionRunnerSrc.includes('attach_network_capture'),
  'session_runner.py imports/attaches attach_network_capture',
);
assert(sessionRunnerSrc.includes('_net_cleanup'), 'session_runner.py keeps _net_cleanup');
ok('session_runner.py wires attach_network_capture + _net_cleanup');

// 5. Real import of network_capture.py under portable Python; check _normalize_url.
function findPython() {
  const candidates = [
    path.join(ROOT, 'python', 'python.exe'),
    'D:/anaconda3/envs/browser_use/python.exe',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error('portable python not found');
}

const python = findPython();
const tmpDir = mkdtempSync(path.join(tmpdir(), 'netcap-'));
const probePath = path.join(tmpDir, 'probe_network_capture.py');
// sys.path points at scripts/ so the relative import
// (...memory.writer in network_capture.py) resolves via the scripts package.
writeFileSync(probePath, [
  'import sys',
  "sys.path.insert(0, r'" + path.join(ROOT, 'scripts') + "')",
  'from scripts.controller.actions.network_capture import _normalize_url',
  'got = _normalize_url("https://app.com/api/form/123/save?x=1")',
  'expected = "https://app.com/api/form/{id}/save"',
  'assert got == expected, f"_normalize_url mismatch: {got}"',
  'print("NORMALIZE_OK")',
  '',
].join('\n'), 'utf8');
const res = spawnSync(python, [probePath], { encoding: 'utf8' });
assert(res.status === 0, `python probe failed: ${res.stderr || res.stdout}`);
assert(res.stdout.includes('NORMALIZE_OK'), 'normalize probe did not print NORMALIZE_OK');
ok(`network_capture.py imports; _normalize_url collapses numeric ids (${python})`);

console.log(`OK ${count}`);
