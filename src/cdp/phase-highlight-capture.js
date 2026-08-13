import {
  buildPhaseHighlightMarkExpression,
  buildPhaseHighlightUnmarkExpression,
  buildPhaseHighlightScrollExpression,
} from './phase-highlight-page.js';
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

export async function runPhaseHighlightCapture(client, targets) {
  let marked = { hitCount: 0, scroll: { top: 0, clientHeight: 0, scrollHeight: 0, overlap: OVERLAP } };
  let markedOk = false;
  let origTop = 0;
  try {
    const evalResult = await cdpEval(client, buildPhaseHighlightMarkExpression(targets || []));
    if (evalResult && typeof evalResult === 'object') marked = evalResult;
    markedOk = true;
    origTop = Number(marked.scroll?.top) || 0;
    const clientHeight = Number(marked.scroll?.clientHeight) || 0;
    const scrollHeight = Number(marked.scroll?.scrollHeight) || 0;
    const ov = Number(marked.scroll?.overlap) || OVERLAP;
    const step = Math.max(1, clientHeight - ov);
    const slices = [];
    let top = 0;
    for (let i = 0; i < MAX_SLICES; i++) {
      await cdpEval(client, buildPhaseHighlightScrollExpression({ top }));
      slices.push(await cdpPng(client));
      if (clientHeight <= 0 || top + clientHeight >= scrollHeight - 1) break;
      top += step;
      if (top > scrollHeight - clientHeight) top = Math.max(0, scrollHeight - clientHeight);
    }
    const buffer = stitchPngSlices(slices, { overlap: ov });
    return { buffer, hitCount: Number(marked.hitCount) || 0 };
  } finally {
    if (markedOk) {
      try {
        await cdpEval(client, buildPhaseHighlightScrollExpression({ top: origTop }));
      } catch {
        /* restore must not hide capture errors */
      }
    }
    try {
      await cdpEval(client, buildPhaseHighlightUnmarkExpression());
    } catch {
      /* unmark must not hide capture errors */
    }
  }
}
