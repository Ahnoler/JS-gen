/**
 * Characterize L1c region classify (+ L1d).
 *   node scripts/characterization/characterize-l1c-region-classify.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  featureSignature,
  shouldLlmClassify,
  classifyRegions,
} from '../../src/services/region-classify.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const helpers = readFileSync(join(root, 'src/cdp/page-locator-helpers.js'), 'utf8');
function ok(n) { console.log(`ok: ${n}`); }

{
  assert.match(helpers, /function buildFeatureCard\s*\(/);
  assert.match(helpers, /feature_card|featureCard/);
  assert.match(helpers, /childCounts|classTokens/);
  ok('helpers: feature card API');
}

{
  const p = join(root, 'src/services/region-classify.js');
  assert.equal(existsSync(p), true);
  const src = readFileSync(p, 'utf8');
  assert.match(src, /export async function classifyRegions\s*\(/);
  assert.match(src, /featureSignature|L1d|l1dCache/);
  assert.match(src, /L1C_LLM|l1cLlm/);
  assert.match(src, /0\.7/);
  assert.match(src, /custom:/);
  ok('service: classifyRegions + trigger + cache cues');
}

{
  const llmCard = {
    classTokens: ['el-main'],
    title: '',
    band: 'center',
    flags: {},
    childCounts: {},
    ruleRole: 'other',
    ruleConfidence: 0.4,
  };
  assert.equal(shouldLlmClassify(llmCard), true);
  assert.equal(featureSignature(llmCard).length, 32);
  await classifyRegions([llmCard], { systemId: 'sys-llm' });
  const llmTwice = await classifyRegions([llmCard], { systemId: 'sys-llm' });
  assert.equal(llmTwice[0].source, 'rule');
  ok('classifyRegions: shouldLlm cards not L1d-cached when L1C_LLM false');
}

{
  const card = {
    classTokens: ['el-main'],
    title: '',
    band: 'center',
    flags: {},
    childCounts: {},
    ruleRole: 'main',
    ruleConfidence: 0.9,
  };
  assert.equal(shouldLlmClassify(card), false);
  await classifyRegions([card], { systemId: 'sys1' });
  const twice = await classifyRegions([card], { systemId: 'sys1' });
  assert.equal(twice[0].source, 'l1d');
  ok('classifyRegions L1d hit for final rule result');
}

console.log('characterize-l1c-region-classify: ok');
