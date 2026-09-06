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
  const src2 = readFileSync(join(root, 'migrations/20260815090000_screenshot_metadata_json.js'), 'utf8');
  assert.match(src2, /metadata_json/);
  ok('migration cues');
}

{
  const sql = readFileSync(join(root, 'schemas/init.sql'), 'utf8');
  assert.match(sql, /phase_highlight/);
  assert.match(sql, /stitch_screenshot_id/);
  assert.match(sql, /uk_ss_phase_group/);  // G 波次后：phase 截图唯一键为 (trajectory_phase_id, state_group)
  assert.match(sql, /metadata_json/);
  ok('init.sql cues');
}

{
  const dao = readFileSync(join(root, 'src/dao/screenshot-dao.js'), 'utf8');
  assert.match(dao, /export async function replaceForPhase/);
  assert.match(dao, /uk_ss_phase_kind|trajectory_phase_id/);
  assert.match(dao, /phase_highlight/);
  assert.match(dao, /metadata_json/);
  assert.match(dao, /listPhaseHighlightsByTrajectory/);
  const svc = readFileSync(join(root, 'src/services/screenshot-service.js'), 'utf8');
  assert.match(svc, /replacePhaseHighlightScreenshot/);
  assert.match(svc, /metadataJson/);
  ok('dao+service replaceForPhase');
}

{
  const { chromium } = await import('playwright');
  const { buildPhaseScreenshotCollectExpression, buildPhaseScreenshotCleanExpression } =
    await import('../../src/cdp/phase-screenshot-page.js');
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
  const first = await page.evaluate(buildPhaseScreenshotCollectExpression());
  assert.ok(Array.isArray(first));
  const inputHit = first.find((e) => e.kind === 'form_input');
  assert.ok(inputHit, 'form input collected');
  assert.equal(typeof inputHit.rect.left, 'number');
  assert.equal(typeof inputHit.rect.top, 'number');
  assert.ok(inputHit.rect.right > inputHit.rect.left);
  assert.ok(Array.isArray(inputHit.layers));
  assert.equal(await page.locator('[data-jsgen-rect]').count(), first.length);
  const second = await page.evaluate(buildPhaseScreenshotCollectExpression());
  assert.equal(second.length, 0, 'marker dedupes across slices');
  await page.evaluate(buildPhaseScreenshotCleanExpression());
  assert.equal(await page.locator('[data-jsgen-rect]').count(), 0);
  await browser.close();
  ok('rect collect expression + dedupe + clean');
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
  const per = PNG.sync.read(stitchPngSlices([a, b, b], { overlaps: [0, 2, 4] }));
  assert.equal(per.height, 10 + (10 - 2) + (10 - 4), 'per-slice overlaps height');
  ok('stitchPngSlices overlap 0 and 2 + per-slice overlaps');
}

{
  const capPath = join(root, 'src/cdp/phase-screenshot-capture.js');
  assert.equal(existsSync(capPath), true, 'phase-screenshot-capture.js must exist');
  const capSrc = readFileSync(capPath, 'utf8');
  assert.match(capSrc, /Page\.captureScreenshot/);
  assert.match(capSrc, /buildPhaseScreenshotCollectExpression/);
  assert.match(capSrc, /stitchPngSlices/);
  assert.match(capSrc, /finally/);
  assert.match(capSrc, /contentHeight/);
  ok('capture module source cues');
}

{
  const { chromium } = await import('playwright');
  const { runPhaseScreenshotCapture } = await import('../../src/cdp/phase-screenshot-capture.js');
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
  const result = await runPhaseScreenshotCapture(client);
  assert.ok(Buffer.isBuffer(result.buffer));
  assert.equal(result.buffer[0], 0x89);
  assert.equal(result.buffer[1], 0x50);
  assert.equal(result.buffer[2], 0x4e);
  assert.equal(result.buffer[3], 0x47);
  assert.ok(Array.isArray(result.meta?.elements));
  assert.ok(result.meta.elements.some((e) => e.kind === 'form_input'));
  assert.ok(result.meta.elements.some((e) => e.kind === 'button'));
  assert.ok(result.meta.contentHeight > 200, 'long page content height');
  assert.equal(await page.locator('[data-jsgen-rect]').count(), 0, 'markers cleaned');
  const { PNG } = await import('pngjs');
  const dims = PNG.sync.read(result.buffer);
  assert.equal(dims.width, result.meta.contentWidth);
  await browser.close();
  ok('runPhaseScreenshotCapture PNG + elements meta + clean');
}

{
  const { chromium } = await import('playwright');
  const { runPhaseScreenshotCapture } = await import('../../src/cdp/phase-screenshot-capture.js');
  const html = `<!DOCTYPE html><html><body style="margin:0">
  <div class="el-main" style="height:200px;overflow:auto">
    <div class="el-form-item"><label>客户编号</label><input id="no"></div>
    <button id="save" style="margin-top:2177px">保存</button>
    <div style="height:300px"></div>
  </div>
  </body></html>`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 400, height: 400 });
  await page.setContent(html);
  const client = await page.context().newCDPSession(page);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  const result = await runPhaseScreenshotCapture(client);
  const { PNG } = await import('pngjs');
  const dims = PNG.sync.read(result.buffer);
  assert.equal(result.meta.contentHeight, dims.height, 'contentHeight == stitched IHDR height (h0 != clientHeight)');
  const save = result.meta.elements.find((e) => e.kind === 'button');
  assert.ok(save, 'save button collected');
  const y = save.rect.top;
  assert.ok(Math.abs(y - 2200) < 6, `save y=${y} should be ~2200 (content position)`);
  assert.ok(save.rect.bottom > save.rect.top);
  assert.equal(await page.locator('[data-jsgen-rect]').count(), 0);
  await browser.close();
  ok('capture geometry discriminates h0 != clientHeight');
}

{
  // I1：末片被 clamp 时，坐标必须仍是内容坐标、图像不得出现重复条带。
  // 视口 400×400、.el-main 400px 满视口、内容总高 1600（maxScroll=1200，非 352 整数倍）、
  // 按钮放内容 y≈1250。旧实现：contentHeight=1808（重复条带）、此块必 FAIL。
  const { chromium } = await import('playwright');
  const { runPhaseScreenshotCapture } = await import('../../src/cdp/phase-screenshot-capture.js');
  const html = `<!DOCTYPE html><html><body style="margin:0">
  <div class="el-main" style="height:400px;overflow:auto">
    <div style="height:1250px"></div>
    <button id="save" style="display:block;height:21px;padding:0;border:0">保存</button>
    <div style="height:329px"></div>
  </div>
  </body></html>`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 400, height: 400 });
  await page.setContent(html);
  const client = await page.context().newCDPSession(page);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  const result = await runPhaseScreenshotCapture(client);
  const { PNG } = await import('pngjs');
  const dims = PNG.sync.read(result.buffer);
  const scrollHeight = await page.evaluate(() => document.querySelector('.el-main').scrollHeight);
  assert.equal(result.meta.contentHeight, 1600, `I1 contentHeight=${result.meta.contentHeight} must be 1600 (no duplicate band)`);
  assert.equal(dims.height, 1600, `I1 stitched IHDR height=${dims.height} must be 1600 (no duplicate band)`);
  assert.equal(result.meta.contentHeight, scrollHeight, 'I1 contentHeight == scrollHeight (clamped final slice)');
  const save = result.meta.elements.find((e) => e.kind === 'button');
  assert.ok(save, 'I1 save button collected');
  const y = save.rect.top;
  assert.ok(Math.abs(y - 1250) < 6, `I1 save y=${y} should be ~1250 (content position in clamp region)`);
  assert.equal(await page.locator('[data-jsgen-rect]').count(), 0, 'I1 markers cleaned');
  await browser.close();
  ok('I1: clamped final slice keeps content coords (contentHeight==dims==1600)');
}

{
  // I2：滚动根比视口小时，片 clip 到根 box——旧实现每片边界丢 (h0-clientHeight) 行内容
  // （条带间隙 [200,352) 内元素收不到/图带进根外背景）。视口 400×400、.el-main 高 200、
  // 按钮 y≈300 与 y≈2200；body 红色背景用于断言拼接图无根外条带。
  const { chromium } = await import('playwright');
  const { runPhaseScreenshotCapture } = await import('../../src/cdp/phase-screenshot-capture.js');
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f00">
  <div class="el-main" style="height:200px;overflow:auto;background:#fff">
    <div class="el-form-item"><label>客户编号</label><input id="no"></div>
    <div style="height:278px"></div>
    <button id="b1" style="display:block;height:21px;padding:0;border:0">按钮一</button>
    <div style="height:1879px"></div>
    <button id="b2" style="display:block;height:21px;padding:0;border:0">按钮二</button>
    <div style="height:300px"></div>
  </div>
  </body></html>`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 400, height: 400 });
  await page.setContent(html);
  const client = await page.context().newCDPSession(page);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  const result = await runPhaseScreenshotCapture(client);
  const { PNG } = await import('pngjs');
  const dims = PNG.sync.read(result.buffer);
  const scrollHeight = await page.evaluate(() => document.querySelector('.el-main').scrollHeight);
  const buttons = result.meta.elements.filter((e) => e.kind === 'button');
  const b1 = buttons.find((e) => Math.abs(e.rect.top - 300) < 30);
  const b2 = buttons.find((e) => Math.abs(e.rect.top - 2200) < 30);
  assert.ok(b1 && b2, 'I2 both buttons collected (gap band element not lost)');
  assert.ok(Math.abs(b1.rect.top - 300) < 6, `I2 b1 y=${b1.rect.top} should be ~300`);
  assert.ok(Math.abs(b2.rect.top - 2200) < 6, `I2 b2 y=${b2.rect.top} should be ~2200`);
  assert.equal(result.meta.contentHeight, dims.height, 'I2 contentHeight == stitched IHDR height');
  assert.equal(result.meta.contentHeight, scrollHeight, `I2 contentHeight=${result.meta.contentHeight} == scrollHeight=${scrollHeight} (no gap bands)`);
  // 图像纯净：stitch 结果不得出现 body 红色背景条带（旧实现视口片把根下方页面带进图）
  let redRows = 0;
  const row = Buffer.alloc(dims.width * 4);
  for (let y = 0; y < dims.height; y++) {
    dims.data.copy(row, 0, y * dims.width * 4, (y + 1) * dims.width * 4);
    let red = true;
    for (let x = 0; x < dims.width && red; x++) {
      const i = x * 4;
      red = row[i] === 255 && row[i + 1] === 0 && row[i + 2] === 0 && row[i + 3] === 255;
    }
    if (red) redRows++;
  }
  assert.equal(redRows, 0, `I2 no body-red rows in stitched image (found ${redRows})`);
  assert.equal(await page.locator('[data-jsgen-rect]').count(), 0, 'I2 markers cleaned');
  await browser.close();
  ok('I2: sub-viewport root clips slices (both buttons, no red band)');
}

{
  // Chrome 149 headed（Windows DPR=1.5）：Page.captureScreenshot 输出 = CSS * dpr * clip.scale。
  // Playwright headless 即使 deviceScaleFactor=1.5 仍返回 CSS 像素，无法复现。
  // 用假 CDP 模拟 Chrome：scale=1 时片高=600；若把 PNG 高当 CSS 步进，拼接高≈1800 且漏缝。
  const { PNG } = await import('pngjs');
  const { runPhaseScreenshotCapture } = await import('../../src/cdp/phase-screenshot-capture.js');
  const dpr = 1.5;
  const clientHeight = 400;
  const scrollHeight = 1600;
  const box = { x: 0, y: 0, width: 400, height: 400 };
  const viewport = { width: 400, height: 400 };
  let scrollTop = 0;
  function solidPng(w, h) {
    const p = new PNG({ width: w, height: h });
    p.data.fill(255);
    return PNG.sync.write(p);
  }
  const client = {
    async send(method, params = {}) {
      if (method === 'Runtime.evaluate') {
        const expr = String(params.expression || '');
        if (expr.includes('root.scrollTop =')) {
          const m = expr.match(/root\.scrollTop = ([0-9.]+)/);
          if (m) scrollTop = Number(m[1]);
          const max = Math.max(0, scrollHeight - clientHeight);
          if (scrollTop > max) scrollTop = max;
          if (scrollTop < 0) scrollTop = 0;
          return {
            result: {
              value: { top: scrollTop, clientHeight, scrollHeight, box, viewport },
            },
          };
        }
        if (expr.includes('removeAttribute')) return { result: { value: { removed: 0 } } };
        return { result: { value: [] } };
      }
      if (method === 'Page.captureScreenshot') {
        const clip = params.clip;
        const scale = Number(clip?.scale) > 0 ? Number(clip.scale) : 1;
        const cssW = Number(clip?.width) > 0 ? Number(clip.width) : viewport.width;
        const cssH = Number(clip?.height) > 0 ? Number(clip.height) : viewport.height;
        const w = Math.round(cssW * dpr * scale);
        const h = Math.round(cssH * dpr * scale);
        return { data: solidPng(Math.max(1, w), Math.max(1, h)).toString('base64') };
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  const result = await runPhaseScreenshotCapture(client);
  const dims = PNG.sync.read(result.buffer);
  assert.equal(result.meta.contentHeight, 1600, `DPR contentHeight=${result.meta.contentHeight} must be CSS 1600`);
  assert.equal(dims.width, 600, `DPR stitched width=${dims.width} must keep Chrome device px (400*1.5)`);
  assert.equal(dims.height, 2400, `DPR stitched IHDR height=${dims.height} must be 1600*1.5 (not mixed-unit 1800)`);
  ok('Chrome 149 dpr=1.5 fake CDP: CSS scroll step, device-px stitch');
}

{
  const src = readFileSync(join(root, 'src/services/trajectory/phase-highlight-screenshot.js'), 'utf8');
  assert.match(src, /export async function capturePhaseScreenshot/);
  assert.match(src, /runPhaseScreenshotCapture/);
  assert.match(src, /deriveRegionRef/);
  assert.match(src, /assembleRegionTree/);
  assert.match(src, /metadataJson: JSON\.stringify\(metadata\)/);
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
  const handler = readFileSync(join(root, 'executor/session-handler.js'), 'utf8');
  assert.match(handler, /bib_phase_highlight_capture/);
  const manager = readFileSync(join(root, 'executor/session-manager.js'), 'utf8');
  assert.match(manager, /meta: captured\.meta/);
  const agent = readFileSync(join(root, 'executor/agent.mjs'), 'utf8');
  assert.match(agent, /meta: result\.meta/);
  const bib = readFileSync(join(root, 'executor/bib-bridge.js'), 'utf8');
  assert.match(bib, /runPhaseScreenshotCapture/);
  ok('executor wire meta cues');
}

{
  const runner = readFileSync(join(root, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');
  assert.match(runner, /_persistDrain/);
  assert.match(runner, /capturePhaseScreenshot/);
  ok('runner drains persist before phase highlight');
}

{
  const qs = readFileSync(join(root, 'src/services/trajectory/trajectory-query-service.js'), 'utf8');
  assert.match(qs, /stitchScreenshotUrl/);
  assert.match(qs, /stitchScreenshotId/);
  const docs = readFileSync(join(root, 'src/dashboard/api-docs/groups/trajectory.js'), 'utf8');
  assert.match(docs, /stitchScreenshotUrl/);
  ok('tree phase_highlight stitch fields');
}
{
  // 内部滚动容器泛化：阶段长图滚动根必须覆盖非标准 class 的滚动容器
  //（如 .plugin-content-list 瀑布流，scrollHeight 6554 / clientHeight 659），
  // 否则回退 document（不滚动）→ 长图只截一屏、瀑布流内容丢失。
  const page = readFileSync(join(root, 'src/cdp/phase-screenshot-page.js'), 'utf8');
  assert.match(page, /querySelectorAll\('div, main, section, article'\)/, 'pickScrollRoot scans generic scroll containers');
  assert.match(page, /scrollHeight > best\.scrollHeight/, 'picks the tallest scrollable container as root');
  assert.match(page, /el\.clientHeight < 100/, 'skips tiny containers');
  ok('pickScrollRoot internal-scroll fallback');
}

console.log('characterize-phase-highlight-screenshot: ok');
