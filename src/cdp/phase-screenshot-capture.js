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
 * 坐标 = 拼接图像素坐标，与 stitchPngSlices 几何完全一致：
 *   片 0：y = rect.top（片内像素行 == rect.top）；
 *   片 i>=1：sliceOffset = h0 + (i-1) * (h0 - OVERLAP)（该片在拼接图中的起始行），
 *   该片前 OVERLAP 行被 stitch 裁掉 → y = sliceOffset + rect.top - OVERLAP。
 * 滚动步长 step = h0 - OVERLAP（由真实片高驱动，而非 clientHeight）。
 */
export async function runPhaseScreenshotCapture(client) {
  let scroll = { top: 0, clientHeight: 0, scrollHeight: 0 };
  let started = false;
  let origTop = 0;
  const elements = [];
  const pushCollected = (collected, offsetY) => {
    for (const el of Array.isArray(collected) ? collected : []) {
      if (!el || !el.rect) continue;
      elements.push({
        kind: el.kind || '',
        text: el.text || '',
        rect: {
          left: Number(el.rect.left) || 0,
          top: (Number(el.rect.top) || 0) + offsetY,
          right: Number(el.rect.right) || 0,
          bottom: (Number(el.rect.bottom) || 0) + offsetY,
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
    const slices = [];
    let truncated = false;
    let top = 0;

    // 片 0：scroll top 0 → collect → capture；以真实 PNG 高 h0 定步长与坐标
    await cdpEval(client, buildPhaseScreenshotScrollExpression({ top }));
    pushCollected(await cdpEval(client, buildPhaseScreenshotCollectExpression()), 0);
    slices.push(await cdpPng(client));
    const h0 = PNG.sync.read(slices[0]).height;
    const step = Math.max(1, h0 - OVERLAP);

    // 片 i>=1：先判覆盖完整则 break（不置截断标记）；否则推进、clamp、scroll、collect、capture
    for (let i = 1; i < MAX_SLICES; i++) {
      if (clientHeight <= 0 || top + clientHeight >= scrollHeight - 1) break;
      top += step;
      if (top > scrollHeight - clientHeight) top = Math.max(0, scrollHeight - clientHeight);
      await cdpEval(client, buildPhaseScreenshotScrollExpression({ top }));
      const sliceOffset = h0 + (i - 1) * (h0 - OVERLAP);
      pushCollected(await cdpEval(client, buildPhaseScreenshotCollectExpression()), sliceOffset - OVERLAP);
      slices.push(await cdpPng(client));
      if (i === MAX_SLICES - 1 && top + clientHeight < scrollHeight - 1) truncated = true;
    }

    const buffer = stitchPngSlices(slices, { overlap: OVERLAP });
    const dims = PNG.sync.read(buffer);
    return {
      buffer,
      meta: {
        contentWidth: dims.width,
        contentHeight: h0 + (slices.length - 1) * (h0 - OVERLAP),
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
