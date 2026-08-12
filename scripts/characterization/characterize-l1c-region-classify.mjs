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

{
  const p = join(root, 'src/services/trajectory/trajectory-record-lifecycle.js');
  const src = readFileSync(p, 'utf8');
  assert.match(src, /function patchRegionFields\s*\(/);
  assert.match(src, /displayGroupOf/);
  assert.match(src, /display_group/);
  // Coarse→refine: never let L1c collapse title overwrite usable assign/refine label.
  assert.match(src, /keepPrevLabel|collision-refine|titlebox refine/);
  assert.match(src, /Preserve collision-refined region_id|keepPrevLabel && prevId/);
  ok('L1c patchRegionFields recomputes display_group; preserves refine labels');
}

{
  // feature_card title: titlebox before collapse (finer panel for L1c input).
  const cardStart = helpers.indexOf('function buildFeatureCard');
  const cardEnd = helpers.indexOf('function isActionOnlyTitle', cardStart);
  const card = helpers.slice(cardStart, cardEnd > cardStart ? cardEnd : cardStart + 4000);
  const tbInCard = card.indexOf("el.closest('.titlebox')");
  const colInCard = card.indexOf("el.closest('.el-collapse-item')");
  assert.ok(tbInCard >= 0 && colInCard >= 0 && tbInCard < colInCard, 'buildFeatureCard prefers titlebox before collapse');
  ok('buildFeatureCard title order: titlebox before collapse');
}

{
  const { displayGroupOf, uniquifyDisplayGroups, isTaxonomyRegionToken } = await import('../../src/cdp/display-group.js');
  assert.equal(isTaxonomyRegionToken('section'), true);
  assert.equal(
    displayGroupOf({ region_label: 'DGSX20260812056002', region_role: 'section' }),
    'DGSX20260812056002',
  );
  assert.equal(
    displayGroupOf({ region_label: 'section', region_role: 'section', xpath_smart: "//div[.='PJ20260806012032']" }),
    'PJ20260806012032',
  );
  assert.equal(
    displayGroupOf({ region_role: 'section', region_label: 'section' }),
    '',
  );
  assert.equal(
    displayGroupOf({ region_role: 'section', region_label: '' }),
    '',
  );
  // Same partition + same label → uniquify
  const dup = uniquifyDisplayGroups([
    {
      preview: { display_group: '同标题卡片', text: '处理', xpath_smart: "//div[.='A']", region_id: 'section:a' },
      element: { display_group: '同标题卡片', text: '处理', xpath_smart: "//div[.='A']" },
    },
    {
      preview: { display_group: '同标题卡片', text: '处理', xpath_smart: "//div[.='B']", region_id: 'section:b' },
      element: { display_group: '同标题卡片', text: '处理', xpath_smart: "//div[.='B']" },
    },
    {
      preview: { display_group: 'PJ1', text: '处理', xpath_smart: "//div[.='PJ1']" },
      element: { display_group: 'PJ1', text: '处理' },
    },
  ]);
  assert.notEqual(dup[0].preview.display_group, dup[1].preview.display_group);
  assert.match(dup[0].preview.display_group, /同标题卡片 · /);
  assert.equal(dup[2].preview.display_group, 'PJ1');

  // Same partition + different labels → keep coarse group (no xpath suffix)
  const distinctLabels = uniquifyDisplayGroups([
    {
      preview: {
        display_group: '对公客户概况',
        text: '客户编号',
        xpath_smart: "//div[contains(@class,'el-form-item')][.//label[normalize-space(.)='客户编号']]//input",
      },
      element: { display_group: '对公客户概况', text: '客户编号' },
    },
    {
      preview: {
        display_group: '对公客户概况',
        text: '客户名称',
        xpath_smart: "//div[contains(@class,'el-form-item')][.//label[normalize-space(.)='客户名称']]//input",
      },
      element: { display_group: '对公客户概况', text: '客户名称' },
    },
  ]);
  assert.equal(distinctLabels[0].preview.display_group, '对公客户概况');
  assert.equal(distinctLabels[1].preview.display_group, '对公客户概况');

  // Same region + same visible select value「否」but different formLabels → do NOT split
  const sameValueSelects = uniquifyDisplayGroups([
    {
      matchedLabel: '异地客户标志',
      preview: {
        display_group: '对公客户概况',
        text: '否',
        formLabel: '异地客户标志',
        xpath_smart: "//div[contains(@class,'el-form-item')][.//label[normalize-space(.)='异地客户标志']]//div[contains(@class,'el-select')]",
      },
      element: { display_group: '对公客户概况', text: '否', formLabel: '异地客户标志' },
    },
    {
      matchedLabel: '扶持类企业标志',
      preview: {
        display_group: '对公客户概况',
        text: '否',
        formLabel: '扶持类企业标志',
        xpath_smart: "//div[contains(@class,'el-form-item')][.//label[normalize-space(.)='扶持类企业标志']]//div[contains(@class,'el-select')]",
      },
      element: { display_group: '对公客户概况', text: '否', formLabel: '扶持类企业标志' },
    },
    {
      matchedLabel: '六大高耗能企业标志',
      preview: {
        display_group: '对公客户概况',
        text: '否',
        formLabel: '六大高耗能企业标志',
        xpath_smart: "//div[contains(@class,'el-form-item')][.//label[normalize-space(.)='六大高耗能企业标志']]//div[contains(@class,'el-select')]",
      },
      element: { display_group: '对公客户概况', text: '否', formLabel: '六大高耗能企业标志' },
    },
  ]);
  assert.equal(sameValueSelects[0].preview.display_group, '对公客户概况');
  assert.equal(sameValueSelects[1].preview.display_group, '对公客户概况');
  assert.equal(sameValueSelects[2].preview.display_group, '对公客户概况');
  assert.ok(!sameValueSelects[0].preview.display_group.includes('el-select'));

  // L1c wiped label to "section" — recover from xpath
  const wiped = uniquifyDisplayGroups([
    {
      preview: {
        display_group: 'section',
        region_label: 'section',
        region_role: 'section',
        xpath_smart: "//div[contains(.,'PJ20260806012032')]//div[.='处理']",
      },
      element: {
        display_group: 'section',
        region_label: 'section',
        xpath_smart: "//div[contains(.,'PJ20260806012032')]//div[.='处理']",
      },
    },
  ]);
  assert.equal(wiped[0].preview.display_group, 'PJ20260806012032');
  ok('displayGroupOf rejects taxonomy tokens; recovers PJ key from xpath');
}

console.log('characterize-l1c-region-classify: ok');
