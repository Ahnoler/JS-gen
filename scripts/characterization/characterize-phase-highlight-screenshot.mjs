/**
 * Phase highlight long-page screenshot.
 *   node scripts/characterization/characterize-phase-highlight-screenshot.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
function ok(n) { console.log(`ok: ${n}`); }

{
  const mig = join(root, 'migrations/20260813100000_phase_highlight_screenshot.js');
  assert.equal(existsSync(mig), true, 'migration file must exist');
  const src = readFileSync(mig, 'utf8');
  assert.match(src, /phase_highlight/);
  assert.match(src, /trajectory_phase_id/);
  assert.match(src, /uk_ss_phase_kind/);
  assert.match(src, /stitch_screenshot_id/);
  ok('migration cues');
}

{
  const sql = readFileSync(join(root, 'schemas/init.sql'), 'utf8');
  assert.match(sql, /phase_highlight/);
  assert.match(sql, /stitch_screenshot_id/);
  assert.match(sql, /uk_ss_phase_kind/);
  ok('init.sql cues');
}

{
  const dao = readFileSync(join(root, 'src/dao/screenshot-dao.js'), 'utf8');
  assert.match(dao, /export async function replaceForPhase/);
  assert.match(dao, /uk_ss_phase_kind|trajectory_phase_id/);
  assert.match(dao, /phase_highlight/);
  const svc = readFileSync(join(root, 'src/services/screenshot-service.js'), 'utf8');
  assert.match(svc, /replacePhaseHighlightScreenshot/);
  ok('dao+service replaceForPhase');
}

{
  const { collectHighlightTargets } = await import('../../src/models/phase-highlight-targets.js');
  const out = collectHighlightTargets([
    { actionType: 'save_form_snapshot', element: { xpath_smart: '//meta' } },
    {
      actionType: 'fill_form_field',
      element: {
        xpath_smart: "//input[@id='a']",
        xpath_full: '/html/body/input',
        region_id: 'section:概况',
        region_label: '对公客户概况',
      },
    },
    { actionType: 'click_element_by_index', elementJson: { xpath_smart: "//button[.='保存']" } },
    { actionType: 'fill_form_field', element: {} },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].xpath_smart, "//input[@id='a']");
  assert.equal(out[0].region_label, '对公客户概况');
  assert.equal(out[1].xpath_smart, "//button[.='保存']");
  assert.ok(!out.some((t) => t.xpath_smart === '//meta'));
  ok('collectHighlightTargets drops meta and empty xpath');
}

{
  const { chromium } = await import('playwright');
  const { buildPhaseHighlightMarkExpression, buildPhaseHighlightUnmarkExpression } =
    await import('../../src/cdp/phase-highlight-page.js');
  const html = `<!DOCTYPE html><html><body>
  <div class="el-main" style="height:200px;overflow:auto">
    <div class="el-form-item"><label>客户编号</label><input id="no"></div>
    <div style="height:400px"></div>
    <button id="save">保存</button>
  </div>
  </body></html>`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html);
  const markExpr = buildPhaseHighlightMarkExpression([
    { xpath_smart: "//input[@id='no']", xpath_full: '', region_id: '', region_label: '' },
    { xpath_smart: "//button[@id='missing']", xpath_full: '', region_id: '', region_label: '' },
  ]);
  const marked = await page.evaluate(markExpr);
  assert.equal(marked.hitCount, 1);
  assert.equal(await page.locator('[data-jsgen-phase-hl="1"]').count(), 1);
  const hlCss = await page.locator('#jsgen-phase-hl-style').evaluate((el) => el.textContent);
  assert.match(hlCss, /rgba\(111,\s*168,\s*220/);
  assert.match(hlCss, /box-shadow/);
  await page.evaluate(buildPhaseHighlightUnmarkExpression());
  assert.equal(await page.locator('[data-jsgen-phase-hl="1"]').count(), 0);
  await browser.close();
  ok('page mark/unmark via evaluate string');
}

{
  const { PNG } = await import('pngjs');
  const { stitchPngSlices } = await import('../../src/cdp/png-stitch.js');
  function solidPng(w, h, r, g, b) {
    const p = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) << 2;
        p.data[i] = r; p.data[i + 1] = g; p.data[i + 2] = b; p.data[i + 3] = 255;
      }
    }
    return PNG.sync.write(p);
  }
  const a = solidPng(10, 10, 255, 0, 0);
  const b = solidPng(10, 10, 0, 255, 0);
  const stacked = PNG.sync.read(stitchPngSlices([a, b], { overlap: 0 }));
  assert.equal(stacked.width, 10);
  assert.equal(stacked.height, 20);
  const ov = PNG.sync.read(stitchPngSlices([a, b], { overlap: 2 }));
  assert.equal(ov.height, 18);
  ok('stitchPngSlices overlap 0 and 2');
}

{
  const capPath = join(root, 'src/cdp/phase-highlight-capture.js');
  assert.equal(existsSync(capPath), true, 'phase-highlight-capture.js must exist');
  const capSrc = readFileSync(capPath, 'utf8');
  assert.match(capSrc, /Page\.captureScreenshot/);
  assert.match(capSrc, /buildPhaseHighlightMarkExpression/);
  assert.match(capSrc, /stitchPngSlices/);
  assert.match(capSrc, /finally/);
  ok('capture module source cues');
}

{
  const { chromium } = await import('playwright');
  const { runPhaseHighlightCapture } = await import('../../src/cdp/phase-highlight-capture.js');
  const html = `<!DOCTYPE html><html><body>
  <div class="el-main" style="height:200px;overflow:auto">
    <div class="el-form-item"><label>客户编号</label><input id="no"></div>
    <div style="height:400px"></div>
    <button id="save">保存</button>
  </div>
  </body></html>`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html);
  const client = await page.context().newCDPSession(page);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  const result = await runPhaseHighlightCapture(client, [
    { xpath_smart: "//input[@id='no']", xpath_full: '', region_id: '', region_label: '' },
  ]);
  assert.ok(Buffer.isBuffer(result.buffer));
  assert.equal(result.buffer[0], 0x89);
  assert.equal(result.buffer[1], 0x50);
  assert.equal(result.buffer[2], 0x4e);
  assert.equal(result.buffer[3], 0x47);
  assert.equal(await page.locator('[data-jsgen-phase-hl]').count(), 0);
  await browser.close();
  ok('runPhaseHighlightCapture PNG magic + unmark');
}

{
  const src = readFileSync(join(root, 'src/services/trajectory/phase-highlight-screenshot.js'), 'utf8');
  assert.match(src, /export async function capturePhaseHighlightScreenshot/);
  assert.match(src, /collectHighlightTargets/);
  assert.match(src, /runPhaseHighlightCapture/);
  assert.match(src, /replacePhaseHighlightScreenshot/);
  assert.match(src, /stitchScreenshotId/);
  assert.match(src, /console\.warn/);
  ok('orchestrator fail-soft cues');
}

{
  const { wrapCaptureError } = await import('../../src/services/trajectory/phase-highlight-screenshot.js');
  assert.deepEqual(wrapCaptureError(new Error('cdp')), { ok: false, skipped: 'cdp' });
  ok('wrapCaptureError fail-soft');
}

{
  const runner = readFileSync(join(root, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');
  assert.match(runner, /capturePhaseHighlightScreenshot/);
  const handler = readFileSync(join(root, 'executor/session-handler.js'), 'utf8');
  assert.match(handler, /bib_phase_highlight_capture/);
  ok('runner + executor wire cues');
}

{
  const runner = readFileSync(join(root, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');
  assert.match(runner, /_persistDrain/);
  assert.match(runner, /capturePhaseHighlightScreenshot/);
  ok('runner drains persist before phase highlight');
}

{
  const qs = readFileSync(join(root, 'src/services/trajectory-query-service.js'), 'utf8');
  assert.match(qs, /stitchScreenshotUrl/);
  assert.match(qs, /stitchScreenshotId/);
  const cl = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(cl, /phase_highlight/);
  const docs = readFileSync(join(root, 'src/dashboard/api-docs/groups/trajectory.js'), 'utf8');
  assert.match(docs, /stitchScreenshotUrl/);
  ok('tree + changelog phase_highlight');
}

console.log('characterize-phase-highlight-screenshot: ok');
