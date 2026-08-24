/**
 * Page-level screenshot (kind='page_level') characterization.
 * Source assertions + pure build/validate functions. No MySQL / browser required.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildScreenshotEntries,
  buildV3Properties,
  buildTransactionEntryV3,
  validatePageLevelCoverage,
  pageKeyFromRegionId,
  popupKeyFromRegionId,
} from '../../src/services/transaction-export-v3.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ok = (n) => console.log(`ok: ${n}`);

{
  const src = readFileSync(join(root, 'migrations/20260819000002_screenshot_page_level.js'), 'utf8');
  assert.match(src, /page_level/);
  assert.match(src, /level_type/);
  assert.match(src, /level_key/);
  assert.match(src, /parent_level_key/);
  assert.match(src, /uk_ss_level_key/);
  ok('migration page_level cues');
}

{
  const sql = readFileSync(join(root, 'schemas/init.sql'), 'utf8');
  assert.match(sql, /page_level/);
  assert.match(sql, /level_type/);
  assert.match(sql, /level_key/);
  assert.match(sql, /parent_level_key/);
  assert.match(sql, /uk_ss_level_key/);
  ok('init.sql page_level cues');
}

{
  const dao = readFileSync(join(root, 'src/dao/screenshot-dao.js'), 'utf8');
  assert.match(dao, /replacePageLevel/);
  assert.match(dao, /findPageLevel/);
  assert.match(dao, /listPageLevelByTrajectory/);
  const svc = readFileSync(join(root, 'src/services/screenshot-service.js'), 'utf8');
  assert.match(svc, /replacePageLevelScreenshot/);
  assert.match(svc, /listPageLevelScreenshotsByTrajectory/);
  ok('dao/service page_level functions');
}

{
  const persist = readFileSync(join(root, 'src/routes/browser-session/persist-live.js'), 'utf8');
  assert.match(persist, /applyPageLevelScreenshot/);
  assert.match(persist, /replacePageLevelScreenshot/);
  const executor = readFileSync(join(root, 'src/routes/browser-session/executor-events.js'), 'utf8');
  assert.match(executor, /page_level_screenshot/);
  const global = readFileSync(join(root, 'src/routes/browser-session/global-browser.js'), 'utf8');
  assert.match(global, /page_level_screenshot/);
  const runner = readFileSync(join(root, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');
  assert.match(runner, /page_level_screenshot/);
  const route = readFileSync(join(root, 'src/routes/v2/export-mgmt.js'), 'utf8');
  const v3Start = route.indexOf('async function maybePushSingleV3');
  const coverageStart = route.indexOf('validatePageLevelCoverage', v3Start);
  assert.ok(v3Start >= 0 && coverageStart >= v3Start, 'V3 route coverage validation lives in maybePushSingleV3');
  ok('node event fan-out page_level_screenshot');
}

{
  const pageKey = 'page:http://test/#/corp/custManage';
  const popupKey = `${pageKey}|dialog:地址选择器`;
  const { entries, idByPageLevel, pageLevelById } = buildScreenshotEntries({
    traj: { id: 99 },
    phases: [],
    pageLevelScreenshots: [
      { levelType: 'page', levelKey: pageKey, imageUrl: 'http://minio/page.png', metadataJson: { displayName: '对公客户管理' } },
      { levelType: 'popup', levelKey: popupKey, parentLevelKey: pageKey, imageUrl: 'http://minio/dialog.png', metadataJson: { displayName: '地址选择器', dialogTitle: '地址选择器', popupRect: { x1: 100, y1: 200, x2: 500, y2: 600 } } },
    ],
  });
  assert.equal(entries.length, 2);
  const page = entries.find((e) => e.type === 'page');
  const dialog = entries.find((e) => e.type === 'popup');
  assert.equal(page.regionId, pageKey);
  assert.equal(dialog.regionId, popupKey);
  assert.equal(dialog.propertiesPID, page.propertiesID);
  assert.deepEqual(dialog.rect, { x1: 100, y1: 200, x2: 500, y2: 600 });
  assert.equal(idByPageLevel.get(pageKey), Number(page.propertiesID));

  const { properties } = buildV3Properties({
    traj: {
      id: 99,
      steps: [
        { stepNumber: 1, actionType: 'fill_form_field', source: 'agent', elementJson: { tag: 'input', target_kind: 'form_input', formLabel: '产品名称', region_id: `${pageKey}|card:产品目录`, page_bbox: { x1: 10, y1: 20, x2: 200, y2: 40 } }, paramsJson: {} },
        { stepNumber: 2, actionType: 'select_option', source: 'agent', elementJson: { tag: 'input', target_kind: 'form_select', formLabel: '省份', region_id: `${popupKey}|overlay:地址选择器`, page_bbox: { x1: 120, y1: 220, x2: 320, y2: 240 } }, paramsJson: {} },
        { stepNumber: 3, actionType: 'click_element_by_index', source: 'agent', elementJson: null, paramsJson: { text: '确认' } },
      ],
    },
    screenshotCount: entries.length,
    idByPageLevel,
    pageLevelById,
    idByDialog: new Map(),
    idByPhase: new Map(),
  });
  // partition-via-pid：页面/弹窗各插入 1 个中间节点（card:/dialog: 角色）；no-element 步骤不建中间节点
  const pageSection = properties.find((p) => p.type === 'card' && p.propertiesPID === page.propertiesID);
  const dialogSection = properties.find((p) => p.type === 'popup' && p.propertiesPID === dialog.propertiesID);
  assert.ok(pageSection, 'page section created');
  assert.ok(dialogSection, 'dialog section created');
  const pageCtrl = properties.find((p) => p.type === 'object' && p.propertiesPID === pageSection.propertiesID);
  const popupCtrl = properties.find((p) => p.type === 'object' && p.propertiesPID === dialogSection.propertiesID);
  const noElement = properties.find((p) => p.type === 'object' && p.propertiesPID === page.propertiesID);
  assert.equal(properties.length, 5);
  assert.equal(pageCtrl.propertiesPID, pageSection.propertiesID);
  assert.equal(popupCtrl.propertiesPID, dialogSection.propertiesID);
  assert.deepEqual(popupCtrl.rect, { x1: 20, y1: 20, x2: 220, y2: 40 });
  assert.equal(noElement.propertiesPID, page.propertiesID); // 无 element_json 步骤经页面上下文继承 pid

  const covered = validatePageLevelCoverage({ transcationProperties: [...entries, ...properties] });
  assert.equal(covered.ok, true);
  assert.equal(covered.exempt.length, 1);
  assert.equal(covered.exempt[0].propertiesID, noElement.propertiesID);
  const missing = validatePageLevelCoverage({ transcationProperties: [...entries, { ...pageCtrl, propertiesPID: '0' }] });
  assert.equal(missing.ok, false);
  assert.equal(missing.missing.length, 1);

  assert.equal(pageKeyFromRegionId(`${pageKey}|card:产品目录`), pageKey);
  assert.equal(popupKeyFromRegionId(`${popupKey}|overlay:地址选择器`), popupKey);
  ok('pure page-level build/validate/coordinates');
}

// payload 出口：rect 统一序列化为 JSON 字符串（空给 ""），弹窗换算在序列化前完成
{
  const pageKey = 'page:http://test/#/corp/custManage';
  const popupKey = `${pageKey}|dialog:地址选择器`;
  const built = buildTransactionEntryV3(
    {
      id: 99,
      steps: [
        {
          stepNumber: 1, actionType: 'select_option', source: 'agent',
          elementJson: { tag: 'input', target_kind: 'form_select', formLabel: '省份', region_id: `${popupKey}|overlay:地址选择器`, page_bbox: { x1: 120, y1: 220, x2: 320, y2: 240 } },
          paramsJson: {},
        },
      ],
    },
    {
      systemId: '98',
      projectId: '31',
      pageLevelScreenshots: [
        { levelType: 'page', levelKey: pageKey, imageUrl: 'http://minio/page.png', metadataJson: { displayName: '对公客户管理' } },
        { levelType: 'popup', levelKey: popupKey, parentLevelKey: pageKey, imageUrl: 'http://minio/dialog.png', metadataJson: { displayName: '地址选择器', dialogTitle: '地址选择器', popupRect: { x1: 100, y1: 200, x2: 500, y2: 600 } } },
      ],
    },
  );
  const props = built.entry.transcationProperties;
  const page = props.find((p) => p.type === 'page');
  const dlg = props.find((p) => p.type === 'popup');
  const ctrl = props.find((p) => p.type === 'object');
  assert.equal(page.rect, '');
  assert.equal(dlg.rect, '{"x1":100,"y1":200,"x2":500,"y2":600}');
  assert.equal(ctrl.rect, '{"x1":20,"y1":20,"x2":220,"y2":40}');
  assert.equal(built.stats.missingPageLevelScreenshots, 0);
  ok('payload rect serialized as JSON string');
}

console.log('characterize-page-level-screenshot: ok');
