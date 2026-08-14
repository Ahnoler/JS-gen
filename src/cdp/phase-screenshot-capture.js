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

async function cdpPng(client) {
  const shot = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  return Buffer.from(shot.data, 'base64');
}

/**
 * 干净阶段长图：无 mark/unmark；同一遍滚动里逐片收集可见 L2 控件 rect。
 * 坐标 = 内容坐标：x = rect.left；y = sliceOffset + rect.top（sliceOffset = i * step）。
 */
export async function runPhaseScreenshotCapture(client) {
  let scroll = { top: 0, clientHeight: 0, scrollHeight: 0 };
  let started = false;
  let origTop = 0;
  const elements = [];
  try {
    const first = await cdpEval(client, buildPhaseScreenshotScrollExpression({ top: 0 }));
    if (first && typeof first === 'object') scroll = first;
    started = true;
    origTop = Number(scroll.top) || 0;
    const clientHeight = Number(scroll.clientHeight) || 0;
    const scrollHeight = Number(scroll.scrollHeight) || 0;
    const step = Math.max(1, clientHeight - OVERLAP);
    const slices = [];
    let truncated = false;
    let top = 0;
    for (let i = 0; i < MAX_SLICES; i++) {
      await cdpEval(client, buildPhaseScreenshotScrollExpression({ top }));
      const collected = await cdpEval(client, buildPhaseScreenshotCollectExpression());
      const sliceOffset = i * step;
      for (const el of Array.isArray(collected) ? collected : []) {
        if (!el || !el.rect) continue;
        elements.push({
          kind: el.kind || '',
          text: el.text || '',
          rect: {
            left: Number(el.rect.left) || 0,
            top: (Number(el.rect.top) || 0) + sliceOffset,
            right: Number(el.rect.right) || 0,
            bottom: (Number(el.rect.bottom) || 0) + sliceOffset,
          },
          layers: Array.isArray(el.layers) ? el.layers : [],
          region_id: el.region_id || '',
          region_label: el.region_label || '',
          outsideRoot: !!el.outsideRoot,
        });
      }
      slices.push(await cdpPng(client));
      if (clientHeight <= 0 || top + clientHeight >= scrollHeight - 1) break;
      if (i === MAX_SLICES - 1) { truncated = true; break; }
      top += step;
      if (top > scrollHeight - clientHeight) top = Math.max(0, scrollHeight - clientHeight);
    }
    const buffer = stitchPngSlices(slices, { overlap: OVERLAP });
    const dims = PNG.sync.read(buffer);
    const contentHeight = clientHeight + Math.max(0, slices.length - 1) * step;
    return {
      buffer,
      meta: {
        contentWidth: dims.width,
        contentHeight,
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
