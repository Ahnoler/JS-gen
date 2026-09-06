/**
 * Phase long-screenshot capture: scroll-stitch visible L2 control rects across slices.
 */
import { PNG } from 'pngjs';
import {
  buildPhaseScreenshotCollectExpression,
  buildPhaseScreenshotCleanExpression,
  buildPhaseScreenshotScrollExpression,
} from './phase-screenshot-page.js';
import { stitchPngSlices } from './png-stitch.js';

const OVERLAP = 48;
const MAX_SLICES = 30;

async function cdpEval(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  });
  if (result?.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'evaluate failed');
  }
  return result?.result?.value;
}

async function cdpPng(client, clip, viewport) {
  const box = clip && typeof clip === 'object' ? clip : null;
  const vw = viewport && typeof viewport === 'object' ? viewport : null;
  // 滚动根 box 比视口小时 clip 到 box（片高 == clientHeight，不再把根外页面带进图）
  const needsClip = !!box && !!vw &&
    ((Number(vw.height) && Number(box.height) < Number(vw.height)) ||
     (Number(vw.width) && Number(box.width) < Number(vw.width)));
  const params = {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  };
  if (needsClip) {
    params.clip = {
      x: Number(box.x) || 0,
      y: Number(box.y) || 0,
      width: Number(box.width) || 0,
      height: Number(box.height) || 0,
      scale: 1,
    };
  }
  const shot = await client.send('Page.captureScreenshot', params);
  return Buffer.from(shot.data, 'base64');
}

/**
 * 干净阶段长图：无 mark/unmark；同一遍滚动里逐片收集可见 L2 控件 rect。
 * 坐标 = 内容坐标（相对滚动根内容区，document 根时 box=(0,0)）：
 *   片 i 元素 x = rect.left - box.x；y = top_i + (rect.top - box.y)。
 * top_i 为 scroll eval 返回的实际 scrollTop（末片被 clamp 到 maxScroll 时即 clamp 值）。
 * Chrome headed 在 DPR≠1 时 captureScreenshot 输出设备像素（h0 = box.height * dpr），
 * scrollTop 仍是 CSS 像素：步进用 CSS（box.height - OVERLAP），stitch skip 用
 * overlaps[i] = h0 - round((top_i - top_{i-1}) * h0 / box.height)。
 * @param {import('./client.js').CdpClient} client CDP client.
 * @returns {Promise<{ buffer: Buffer, meta: { contentWidth: number, contentHeight: number, truncated: boolean, elements: object[] } }>} Stitched long screenshot + collected element rects.
 */
export async function runPhaseScreenshotCapture(client) {
  let scroll = { top: 0, clientHeight: 0, scrollHeight: 0 };
  let started = false;
  let origTop = 0;
  const elements = [];
  const pushCollected = (collected, topI, box) => {
    const bx = Number(box?.x) || 0;
    const by = Number(box?.y) || 0;
    for (const el of Array.isArray(collected) ? collected : []) {
      if (!el || !el.rect) continue;
      elements.push({
        kind: el.kind || '',
        text: el.text || '',
        rect: {
          left: (Number(el.rect.left) || 0) - bx,
          top: topI + ((Number(el.rect.top) || 0) - by),
          right: (Number(el.rect.right) || 0) - bx,
          bottom: topI + ((Number(el.rect.bottom) || 0) - by),
        },
        layers: Array.isArray(el.layers) ? el.layers : [],
        region_id: el.region_id || '',
        region_label: el.region_label || '',
        outsideRoot: !!el.outsideRoot,
      });
    }
  };
  try {
    const first = await cdpEval(client, buildPhaseScreenshotScrollExpression({ top: 0 }));
    if (first && typeof first === 'object') scroll = first;
    started = true;
    origTop = Number(scroll.top) || 0;
    const clientHeight = Number(scroll.clientHeight) || 0;
    const scrollHeight = Number(scroll.scrollHeight) || 0;
    const box = scroll.box || { x: 0, y: 0, width: 0, height: 0 };
    const viewport = scroll.viewport || { width: 0, height: 0 };
    const slices = [];
    const tops = [Number(scroll.top) || 0];
    let truncated = false;

    // 片 0：scroll top 0 → collect → capture。h0 可能是设备像素；步进必须用 CSS 片高。
    pushCollected(await cdpEval(client, buildPhaseScreenshotCollectExpression()), tops[0], box);
    slices.push(await cdpPng(client, box, viewport));
    const h0 = PNG.sync.read(slices[0]).height;
    const cssSliceH = Number(box.height) || clientHeight;
    const pxPerCss = cssSliceH > 0 ? h0 / cssSliceH : 1;
    const stepCss = Math.max(1, cssSliceH - OVERLAP);

    // 片 i>=1：先判覆盖完整则 break（非截断）；否则按 CSS step 推进、clamp、scroll、collect、capture
    for (let i = 1; i < MAX_SLICES; i++) {
      if (clientHeight <= 0 || tops[i - 1] + clientHeight >= scrollHeight - 1) break;
      const next = Math.min(tops[i - 1] + stepCss, scrollHeight - clientHeight);
      const scrolled = await cdpEval(client, buildPhaseScreenshotScrollExpression({ top: next }));
      const topI = Number(scrolled?.top) || 0;
      pushCollected(await cdpEval(client, buildPhaseScreenshotCollectExpression()), topI, box);
      slices.push(await cdpPng(client, box, viewport));
      tops.push(topI);
      if (i === MAX_SLICES - 1) truncated = true;
    }

    // 每片实际 overlap（设备像素）：clamp 时 skip 更大，图像仍连续
    const overlaps = [];
    for (let i = 1; i < tops.length; i++) {
      overlaps[i] = h0 - Math.round((tops[i] - tops[i - 1]) * pxPerCss);
    }
    const buffer = stitchPngSlices(slices, { overlaps });
    const dims = PNG.sync.read(buffer);
    const topLast = tops[tops.length - 1] || 0;
    // imageWidth/imageHeight 为 IHDR 实际值；contentWidth/contentHeight 为内容空间；
    // stitch 12MB 降采样时二者不同，前端按 imageHeight/contentHeight 比例缩放坐标。
    return {
      buffer,
      meta: {
        contentWidth: dims.width,
        contentHeight: topLast + clientHeight,
        truncated,
        elements,
      },
    };
  } finally {
    if (started) {
      try {
        await cdpEval(client, buildPhaseScreenshotScrollExpression({ top: origTop }));
      } catch {
        /* restore must not hide capture errors */
      }
    }
    try {
      await cdpEval(client, buildPhaseScreenshotCleanExpression());
    } catch {
      /* clean must not hide capture errors */
    }
  }
}
