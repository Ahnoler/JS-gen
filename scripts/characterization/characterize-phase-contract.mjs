/**
 * Characterization: phase contract v1 allowlist (方案 D).
 *
 * Run: node scripts/characterization/characterize-phase-contract.mjs
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { normalizePhaseContract } from '../../src/services/trajectory/phase-contract.js';
import { parseAnalyzePayload } from '../../src/services/trajectory/trajectory-meta-service.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const nav = normalizePhaseContract({
  v: 1,
  mode: 'navigate',
  refill: 'none',
  submitRequired: false,
  successWhen: ['url_change', 'page_opened', 'url_change'],
  source: 'analyze',
});
assert(nav && nav.mode === 'navigate', 'navigate kept');
assert(nav.successWhen.join(',') === 'url_change,page_opened', 'kinds deduped, order kept');

assert(normalizePhaseContract({ v: 1, mode: 'verify', refill: 'none', submitRequired: false, successWhen: [], source: 'analyze' }) === null, 'verify rejected');
assert(normalizePhaseContract({ v: 1, mode: 'create', refill: 'all_editable', submitRequired: true, successWhen: ['not_a_kind'], source: 'analyze' }) === null, 'unknown kind rejected');
assert(normalizePhaseContract({ v: 1, mode: 'query', refill: 'all_editable', submitRequired: false, successWhen: ['query_clicked'], source: 'analyze' }) === null, 'refill only on create/modify');
assert(normalizePhaseContract({ v: 1, mode: 'navigate', refill: 'none', submitRequired: true, successWhen: ['page_opened'], source: 'analyze' }) === null, 'submitRequired only on create/modify/introduce_pick');
assert(normalizePhaseContract({ v: 2, mode: 'other', refill: 'none', submitRequired: false, successWhen: [], source: 'analyze' }) === null, 'version rejected');
assert(normalizePhaseContract(null) === null, 'null rejected');

const fill = normalizePhaseContract({
  v: 1, mode: 'create', refill: 'all_editable', submitRequired: false, successWhen: [], source: 'analyze',
});
assert(fill && fill.successWhen.length === 0, 'empty kinds allowed');

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const phaseSvc = readFileSync(join(root, 'src/services/trajectory/trajectory-phase-service.js'), 'utf8');
assert(phaseSvc.includes('patch.contract_json = null'), 'description change clears contract');
const initSql = readFileSync(join(root, 'schemas/init.sql'), 'utf8');
assert(initSql.includes('contract_json'), 'init.sql has contract_json');

const legacy = parseAnalyzePayload('{"phases":["点击菜单。预期结果：抵达列表。"]}');
assert(legacy.phases.length === 1 && legacy.phases[0].description.includes('点击菜单'), 'string phase kept');
assert(legacy.phases[0].contract === null, 'string phase has no contract');

const obj = parseAnalyzePayload(JSON.stringify({
  phases: [{
    description: '点击【引入】。预期结果：打开客户选择窗口。',
    mode: 'navigate', refill: 'none', submitRequired: false,
    successWhen: ['url_change', 'page_opened'],
  }, { description: '', mode: 'other' }],
}));
assert(obj.phases.length === 1, 'empty description dropped');
assert(obj.phases[0].contract && obj.phases[0].contract.mode === 'navigate', 'object contract normalized');

const bad = parseAnalyzePayload(JSON.stringify({
  phases: [{ description: '填写名称。预期结果：填写完成。', mode: 'verify', refill: 'none', submitRequired: false, successWhen: [] }],
}));
assert(bad.phases.length === 1 && bad.phases[0].contract === null, 'bad mode keeps description, drops contract');

const meta = readFileSync(join(root, 'src/services/trajectory/trajectory-meta-service.js'), 'utf8');
assert(meta.includes('phaseContracts'), 'create accepts phaseContracts');
assert(meta.includes('contractJson: normalizePhaseContract'), 'create normalizes before insert');

const runner = readFileSync(join(root, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');
assert(runner.includes('phase_contract'), 'runner forwards phase_contract');
assert(runner.includes('normalizePhaseContract'), 'runner re-validates before send');

const apiDocs = readFileSync(join(root, 'src/dashboard/api-docs/groups/trajectory.js'), 'utf8');
assert(apiDocs.includes('phaseContracts'), 'api docs mention phaseContracts');
assert(apiDocs.includes('contractJson'), 'api docs mention contractJson');

console.log('characterize-phase-contract OK');
