/**
 * Partition compose: tab + wizard + collapse + titlebox.
 *   node scripts/characterization/characterize-partition-compose.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PAGE_LOCATOR_HELPERS } from '../../src/cdp/page-locator-helpers.js';
import { displayGroupOf, isTaxonomyRegionToken } from '../../src/cdp/display-group.js';
import { prependPageLayer as prependNodePageLayer } from '../../src/cdp/region-layers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
function ok(n) { console.log(`ok: ${n}`); }

const helpersSrc = readFileSync(join(root, 'src/cdp/page-locator-helpers.js'), 'utf8');

{
  assert.match(helpersSrc, /function composeContentRegion\s*\(/);
  assert.match(helpersSrc, /function nearestPageSteps\s*\(/);
  assert.match(helpersSrc, /function stripActionTail\s*\(/);
  assert.match(helpersSrc, /function finishCompose\s*\(/);
  assert.match(helpersSrc, /function mergeTitleboxIntoRegion\s*\(/);
  assert.match(helpersSrc, /function buildRegionLayers\s*\(/);
  assert.match(helpersSrc, /function prependPageLayer\s*\(/);
  assert.match(helpersSrc, /tags-view-container/);
  assert.match(helpersSrc, /region_chrome:\s*region\.region_chrome/);
  assert.match(helpersSrc, /region_section:\s*region\.region_section/);
  assert.match(helpersSrc, /region_block:\s*region\.region_block/);
  ok('helpers: compose API cues');
}

{
  const elSrc = readFileSync(join(root, 'src/models/element.js'), 'utf8');
  assert.match(elSrc, /region_chrome/);
  assert.match(elSrc, /region_section/);
  assert.match(elSrc, /region_block/);
  assert.match(elSrc, /layers/);
  ok('element_json copies structured region fields');
}

{
  assert.equal(isTaxonomyRegionToken('tab'), true);
  assert.equal(isTaxonomyRegionToken('wizard'), true);
  assert.equal(isTaxonomyRegionToken('todo'), true);
  assert.equal(isTaxonomyRegionToken('客户基本信息 / 对公客户概况'), false);
  assert.equal(
    displayGroupOf({
      region_label: '客户基本信息 / 对公客户概况 / 法定代表人/负责人信息',
      region_id: 'tab:客户基本信息|section:对公客户概况|titlebox:法定代表人/负责人信息',
    }),
    '客户基本信息 / 对公客户概况 / 法定代表人/负责人信息',
  );
  assert.equal(
    displayGroupOf({ region_label: '客户基本信息 / 对公客户概况 / 法定代表人/负责人信息' }),
    '客户基本信息 / 对公客户概况 / 法定代表人/负责人信息',
  );
  assert.deepEqual(
    prependNodePageLayer([{ role: 'tab', label: '客户基本信息' }], '对公客户管理')[0],
    { role: 'page', label: '对公客户管理' },
  );
  ok('display_group keeps composed Chinese path');
}

const FIXTURE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>partition compose</title>
<style>
  .el-tabs__item, .el-step, .el-collapse-item__header, span.title, .field, button {
    display: block; padding: 4px 8px;
  }
  .titlebox { margin: 16px 0; min-height: 24px; }
  .titlebox-section { min-height: 32px; }
  .el-tab-pane, .el-main, .el-collapse-item { min-height: 40px; }
  header, .tags-view-container { min-height: 20px; }
</style></head><body>
<header>
  <div class="tags-view-container">
    <div class="el-tabs">
      <div class="el-tabs__item is-active">对公客户管理</div>
    </div>
  </div>
</header>
<div id="corp" class="el-tabs">
  <div class="el-tabs__header">
    <div class="el-tabs__item is-active">客户基本信息</div>
    <div class="el-tabs__item">客户综合信息</div>
  </div>
  <div class="el-tab-pane">
    <div class="el-collapse-item">
      <div class="el-collapse-item__header">对公客户概况</div>
      <div class="el-collapse-item__wrap">
        <div class="titlebox"><span class="title">基本信息</span>
          <input id="corp-basic" class="field" value="x" />
        </div>
        <div class="titlebox"><span class="title">法定代表人/负责人信息</span>
          <input id="corp-legal" class="field" value="y" />
        </div>
        <div class="titlebox"><span class="title">实际控制人</span>
          <input id="corp-actual" class="field" value="z" />
        </div>
      </div>
    </div>
  </div>
</div>
<div id="float-bar"><button id="float-back">返回</button></div>
<div id="ops" class="el-collapse-item">
  <div class="el-collapse-item__header">经营情况 保存</div>
  <div class="el-collapse-item__wrap">
    <button id="ops-save">保存</button>
  </div>
</div>
<div id="wizard-page">
  <div class="el-steps">
    <div class="el-step is-horizontal is-finish"><div class="el-step__title">基本信息</div></div>
    <div class="el-step is-horizontal"><div class="el-step__title">影像资料</div></div>
    <div class="el-step is-horizontal is-wait"><div class="el-step__title">风险阻断</div></div>
  </div>
  <main class="el-main">
    <button id="img-upload">上传</button>
  </main>
</div>
<div id="wizard-process">
  <div class="el-steps">
    <div class="el-step is-horizontal is-finish"><div class="el-step__title">基本信息</div></div>
    <div class="el-step is-horizontal is-process"><div class="el-step__title">影像资料</div></div>
  </div>
  <main class="el-main"><button id="img-process">下一步</button></main>
</div>
<div id="wizard-wrapped">
  <div class="steps-wrapper">
    <div class="el-steps">
      <div class="el-step is-horizontal">
        <div class="el-step__head is-finish"><div class="el-step__title is-finish">基本信息</div></div>
      </div>
      <div class="el-step is-horizontal">
        <div class="el-step__head is-process"><div class="el-step__title is-process">影像资料</div></div>
      </div>
    </div>
  </div>
  <main class="el-main">
    <button id="img-wrapped">下一步</button>
  </main>
</div>
<div id="rate-wizard-step1">
  <div class="steps-wrapper">
    <div class="el-steps">
      <div class="el-step is-horizontal">
        <div class="el-step__head is-process"><div class="el-step__title is-process">基本信息</div></div>
      </div>
      <div class="el-step is-horizontal">
        <div class="el-step__head is-wait"><div class="el-step__title is-wait">影像资料</div></div>
      </div>
    </div>
  </div>
  <main class="el-main">
    <div class="el-collapse-item">
      <div class="el-collapse-item__header">评级基本情况</div>
      <div class="titlebox"><span class="title">基本信息</span>
        <input id="rate-wiz-basic" class="field" />
      </div>
    </div>
  </main>
</div>
<div class="app-main">
<form id="rate-form" class="el-form">
  <div class="el-col el-col-24">
    <div class="steps-wrapper">
      <div class="el-steps">
        <div class="el-step is-horizontal">
          <div class="el-step__head is-finish"><div class="el-step__title is-finish">基本信息</div></div>
        </div>
        <div class="el-step is-horizontal">
          <div class="el-step__head is-process"><div class="el-step__title is-process">影像资料</div></div>
        </div>
      </div>
    </div>
  </div>
  <div class="el-col el-col-24">
    <div class="steprow">
      <span id="img-form-next" class="tsscBtn">下一步</span>
    </div>
  </div>
</form>
</div>
<div id="no-chrome" class="el-collapse-item">
  <div class="el-collapse-item__header">评级基本情况</div>
  <div class="titlebox"><span class="title">基本信息</span>
    <input id="rate-basic" class="field" />
  </div>
</div>
<div id="rate-bottom-bar" class="app-main">
  <div class="steps-wrapper">
    <div class="el-steps">
      <div class="el-step is-horizontal">
        <div class="el-step__head is-process"><div class="el-step__title is-process">基本信息</div></div>
      </div>
      <div class="el-step is-horizontal">
        <div class="el-step__head is-wait"><div class="el-step__title is-wait">影像资料</div></div>
      </div>
    </div>
  </div>
  <main class="el-main">
    <div class="el-collapse-item">
      <div class="el-collapse-item__header">征信信息</div>
      <div class="titlebox"><span class="title">征信信息</span>
        <input id="rate-credit" class="field" />
      </div>
    </div>
  </main>
  <div class="bottom-position-btn">
    <button id="rate-next">下一步</button>
    <button id="rate-back">返回</button>
  </div>
</div>
<table class="el-table" id="tbl"><tbody><tr><td><button id="tbl-btn">修改</button></td></tr></tbody></table>
<div class="el-dialog"><div class="el-dialog__title">提示</div><button id="dlg-ok">确定</button></div>
<div class="todo-item">
  <div class="todo-item__header">【对公授信申请】信贷调查
    <div class="todo-item-actions"><div class="todo-item-action">处理</div></div>
  </div>
  <div>业务主键： DGSX20260812056002</div>
  <button id="todo-handle">处理</button>
</div>
<div id="dup-btns" class="el-collapse-item">
  <div class="el-collapse-item__header">综合信息</div>
  <div class="el-collapse-item__wrap">
    <div class="titlebox-section">
      <div class="titlebox"><span class="title">资产信息</span>
        <button>新增</button>
      </div>
    </div>
    <div class="titlebox-section">
      <div class="titlebox"><span class="title">客户联系信息</span>
        <button>新增</button>
      </div>
    </div>
  </div>
</div>
</body></html>`;

function assignExpr(selector) {
  return `(() => {
${PAGE_LOCATOR_HELPERS}
    const el = document.querySelector(${JSON.stringify(selector)});
    return assignRegion(el);
  })()`;
}

function snapExpr(selector, text) {
  return `(() => {
${PAGE_LOCATOR_HELPERS}
    const host = document.querySelector(${JSON.stringify(selector)});
    const abs = absXPath(host);
    return buildLocatorSnap(host, ${JSON.stringify(text)}, abs, '', { targetKind: 'button' });
  })()`;
}

function snapInTitlebox(titleboxTitle, text) {
  return `(() => {
${PAGE_LOCATOR_HELPERS}
    const boxes = Array.from(document.querySelectorAll('.titlebox'));
    const box = boxes.find((b) => {
      const t = b.querySelector('span.title');
      return t && String(t.textContent || '').replace(/\\s+/g, ' ').trim() === ${JSON.stringify(titleboxTitle)};
    });
    const host = box && box.querySelector('button');
    const abs = absXPath(host);
    return buildLocatorSnap(host, ${JSON.stringify(text)}, abs, '', { targetKind: 'button' });
  })()`;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(FIXTURE);

  const legal = await page.evaluate(assignExpr('#corp-legal'));
  assert.equal(legal.region_role, 'section');
  assert.match(String(legal.region_label), /客户基本信息/);
  assert.match(String(legal.region_label), /对公客户概况/);
  assert.match(String(legal.region_label), /法定代表人\/负责人信息/);
  assert.equal(
    legal.region_label,
    '客户基本信息 / 对公客户概况 / 法定代表人/负责人信息',
  );
  assert.match(String(legal.region_id), /tab:客户基本信息/);
  assert.match(String(legal.region_id), /section:对公客户概况/);
  assert.match(String(legal.region_id), /titlebox:法定代表人\/负责人信息/);
  assert.equal(legal.region_chrome && legal.region_chrome.role, 'tab');
  assert.equal(legal.region_chrome && legal.region_chrome.label, '客户基本信息');
  assert.equal(legal.region_section, '对公客户概况');
  assert.equal(legal.region_block, '法定代表人/负责人信息');
  assert.doesNotMatch(String(legal.region_label), /对公客户管理/);
  assert.deepEqual(legal.layers, [
    { role: 'tab', label: '客户基本信息' },
    { role: 'section', label: '对公客户概况' },
    { role: 'titlebox', label: '法定代表人/负责人信息' },
  ]);
  ok('tab + collapse + titlebox three segments');

  const actual = await page.evaluate(assignExpr('#corp-actual'));
  assert.equal(actual.region_block, '实际控制人');
  assert.notEqual(actual.region_id, legal.region_id);
  ok('adjacent titleboxes stay distinct');

  const floatBack = await page.evaluate(assignExpr('#float-back'));
  assert.equal(floatBack.region_role, 'other');
  assert.equal(floatBack.region_id, 'other');
  assert.doesNotMatch(String(floatBack.region_label), /实际控制人/);
  assert.doesNotMatch(String(floatBack.region_label), /对公客户概况/);
  assert.deepEqual(floatBack.layers, []);
  ok('bare page-level button outside panes does NOT inherit titlebox');

  const ops = await page.evaluate(assignExpr('#ops-save'));
  assert.equal(ops.region_section, '经营情况');
  assert.doesNotMatch(String(ops.region_label), /经营情况 保存/);
  assert.match(String(ops.region_id), /section:经营情况/);
  ok('collapse header strips trailing 保存');

  const img = await page.evaluate(assignExpr('#img-upload'));
  assert.equal(img.region_role, 'wizard');
  assert.equal(img.region_label, '影像资料');
  assert.match(String(img.region_id), /^wizard:影像资料$/);
  assert.notEqual(img.region_role, 'main');
  assert.doesNotMatch(String(img.region_label), /基本信息/);
  assert.equal(img.region_chrome && img.region_chrome.role, 'wizard');
  ok('wizard sibling steps, no collapse → not main');

  const img2 = await page.evaluate(assignExpr('#img-process'));
  assert.equal(img2.region_label, '影像资料');
  assert.equal(img2.region_role, 'wizard');
  ok('wizard is-process class');

  const imgWrap = await page.evaluate(assignExpr('#img-wrapped'));
  assert.equal(imgWrap.region_role, 'wizard');
  assert.equal(imgWrap.region_label, '影像资料');
  assert.match(String(imgWrap.region_id), /^wizard:影像资料$/);
  assert.notEqual(imgWrap.region_role, 'main');
  ok('wizard .steps-wrapper + is-process on head, not step root');

  const rateWiz = await page.evaluate(assignExpr('#rate-wiz-basic'));
  assert.equal(rateWiz.region_label, '基本信息 / 评级基本情况 / 基本信息');
  assert.match(String(rateWiz.region_id), /wizard:基本信息/);
  assert.match(String(rateWiz.region_id), /section:评级基本情况/);
  assert.match(String(rateWiz.region_id), /titlebox:基本信息/);
  ok('wrapped wizard chrome + collapse + titlebox');

  const imgForm = await page.evaluate(assignExpr('#img-form-next'));
  assert.equal(imgForm.region_role, 'wizard');
  assert.equal(imgForm.region_label, '影像资料');
  assert.match(String(imgForm.region_id), /^wizard:影像资料$/);
  assert.notEqual(imgForm.region_role, 'main');
  assert.deepEqual(imgForm.layers, [{ role: 'wizard', label: '影像资料' }]);
  ok('wizard in sibling el-col under form (steps-wrapper two levels down)');

  const rate = await page.evaluate(assignExpr('#rate-basic'));
  assert.match(String(rate.region_label), /评级基本情况/);
  assert.match(String(rate.region_label), /基本信息/);
  assert.doesNotMatch(String(rate.region_id), /tab:/);
  assert.doesNotMatch(String(rate.region_id), /wizard:/);
  assert.equal(rate.layers && rate.layers[0] && rate.layers[0].role, 'section');
  assert.equal(rate.layers[rate.layers.length - 1].role, 'titlebox');
  assert.ok(!(rate.layers || []).some((x) => x.role === 'tab' || x.role === 'wizard' || x.role === 'page'));
  ok('no chrome: collapse + titlebox only');

  const rateNext = await page.evaluate(assignExpr('#rate-next'));
  assert.equal(rateNext.region_role, 'wizard');
  assert.equal(rateNext.region_label, '基本信息');
  assert.match(String(rateNext.region_id), /^wizard:基本信息$/);
  assert.equal(rateNext.region_block, undefined);
  assert.deepEqual(rateNext.layers, [{ role: 'wizard', label: '基本信息' }]);
  ok('bottom-bar 下一步 button: wizard-only, no titlebox inheritance');

  const rateBack = await page.evaluate(assignExpr('#rate-back'));
  assert.equal(rateBack.region_role, 'wizard');
  assert.equal(rateBack.region_label, '基本信息');
  assert.equal(rateBack.region_block, undefined);
  ok('bottom-bar 返回 button: wizard-only too');

  const rateCredit = await page.evaluate(assignExpr('#rate-credit'));
  assert.equal(rateCredit.region_label, '基本信息 / 征信信息 / 征信信息');
  assert.match(String(rateCredit.region_id), /wizard:基本信息/);
  assert.match(String(rateCredit.region_id), /section:征信信息/);
  assert.match(String(rateCredit.region_id), /titlebox:征信信息/);
  assert.deepEqual(rateCredit.layers.map((x) => x.role), ['wizard', 'section', 'titlebox']);
  ok('input in collapse+titlebox keeps full layers (buttons-only rule)');

  const tbl = await page.evaluate(assignExpr('#tbl-btn'));
  assert.equal(tbl.region_role, 'table');
  assert.equal(tbl.region_id, 'table');
  assert.deepEqual(tbl.layers, [{ role: 'table', label: '表格' }]);
  ok('table short-circuit');

  const dlg = await page.evaluate(assignExpr('#dlg-ok'));
  assert.equal(dlg.region_role, 'overlay');
  assert.equal(dlg.layers && dlg.layers[0] && dlg.layers[0].role, 'overlay');
  assert.equal(dlg.layers.length, 1);
  ok('overlay short-circuit');

  const todo = await page.evaluate(assignExpr('#todo-handle'));
  assert.equal(todo.region_role, 'todo');
  assert.match(String(todo.region_label), /对公授信申请|信贷调查/);
  assert.equal(todo.layers && todo.layers[0] && todo.layers[0].role, 'todo');
  assert.equal(todo.layers.length, 1);
  ok('todo-item still before compose; region_role todo');

  const assetSnap = await page.evaluate(snapInTitlebox('资产信息', '新增'));
  const contactSnap = await page.evaluate(snapInTitlebox('客户联系信息', '新增'));
  assert.equal(assetSnap.region_block, '资产信息');
  assert.equal(contactSnap.region_block, '客户联系信息');
  assert.notEqual(assetSnap.region_block, contactSnap.region_block);
  assert.match(String(assetSnap.xpath_smart), /titlebox/);
  assert.match(String(contactSnap.xpath_smart), /titlebox/);
  assert.match(String(assetSnap.xpath_smart), /资产信息/);
  assert.match(String(contactSnap.xpath_smart), /客户联系信息/);
  assert.ok(
    (assetSnap.layers || []).some((x) => x.role === 'titlebox' && x.label === '资产信息'),
  );
  assert.ok(
    (contactSnap.layers || []).some((x) => x.role === 'titlebox' && x.label === '客户联系信息'),
  );
  ok('duplicate 新增 buttons titlebox-anchored xpath_smart');

  const pre = await page.evaluate(`(() => {
${PAGE_LOCATOR_HELPERS}
    const a = prependPageLayer(
      [{ role: 'tab', label: '客户基本信息' }],
      '对公客户管理'
    );
    const b = prependPageLayer(
      [{ role: 'page', label: '已有页' }, { role: 'page', label: '内层' }, { role: 'tab', label: 'T' }],
      ''
    );
    const c = prependPageLayer(
      [{ role: 'page', label: '已有页' }, { role: 'tab', label: 'T' }],
      '对公客户管理'
    );
    return { a, b, c };
  })()`);
  assert.deepEqual(pre.a, [
    { role: 'page', label: '对公客户管理' },
    { role: 'tab', label: '客户基本信息' },
  ]);
  assert.equal(pre.b[0].role, 'page');
  assert.equal(pre.b[0].label, '已有页');
  assert.ok(!(pre.b || []).slice(1).some((x) => x.role === 'page'));
  assert.equal(pre.c[0].label, '已有页');
  assert.equal(pre.c.length, 2);
  ok('prependPageLayer: head insert; drop inner page; do not double page');

  await browser.close();
  console.log('characterize-partition-compose: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
