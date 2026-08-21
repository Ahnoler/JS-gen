import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import * as trajectoryPhaseDao from '../../dao/trajectory-phase-dao.js';
import { runPhaseScreenshotCapture } from '../../cdp/phase-screenshot-capture.js';
import { deriveRegionRef, assembleRegionTree } from '../region-tree.js';
import { replacePhaseHighlightScreenshot } from '../screenshot-service.js';
import { USE_EXECUTOR } from '#config/config.js';
import * as execSession from '../../executor-session-client.js';
import { getAttachedCdpClient } from '../../cdp/remote-bridge.js';

export function wrapCaptureError(err) {
  console.warn('[record] phase screenshot skipped:', err?.message || err);
  return { ok: false, skipped: String(err?.message || err || 'error') };
}

function buildMetadata(buffer, meta) {
  const dims = PNG.sync.read(buffer);
  const elements = (Array.isArray(meta?.elements) ? meta.elements : []).map((el, index) => {
    const { regionId, parentRegionId } = deriveRegionRef({
      layers: el.layers,
      region_id: el.region_id,
      region_label: el.region_label,
    });
    return {
      index,
      kind: String(el.kind || ''),
      label: String(el.text || ''),
      layers: Array.isArray(el.layers) ? el.layers : [],
      regionId,
      parentRegionId,
      rect: el.rect
        ? { x1: el.rect.left, y1: el.rect.top, x2: el.rect.right, y2: el.rect.bottom }
        : null,
      outsideRoot: !!el.outsideRoot,
    };
  });
  let regionTree = null;
  try {
    regionTree = assembleRegionTree(
      elements.map((e) => ({ layers: e.layers })),
      { pageLabel: '' },
    );
  } catch (err) {
    // 树组装失败不丢整张截图：regionTree 落 null，元素坐标仍正常入库
    console.warn('[record] region tree skipped:', err?.message || err);
  }
  return {
    imageWidth: dims.width,
    imageHeight: dims.height,
    contentWidth: Number(meta?.contentWidth) || dims.width,
    contentHeight: Number(meta?.contentHeight) || dims.height,
    truncated: !!meta?.truncated,
    elements,
    regionTree,
  };
}

export async function capturePhaseScreenshot({
  trajectoryId,
  phaseId,
  cdpClient,
  sessionId,
  executorNodeUuid,
} = {}) {
  try {
    let buffer;
    let meta = null;

    if (cdpClient) {
      const captured = await runPhaseScreenshotCapture(cdpClient);
      buffer = captured.buffer;
      meta = captured.meta;
    } else if (USE_EXECUTOR && executorNodeUuid && sessionId) {
      const requestId = randomUUID();
      const resultP = execSession.waitForSessionEvent(
        sessionId,
        'session.bib_phase_highlight_capture_result',
        60000,
      );
      execSession.sendToExecutor(executorNodeUuid, 'session.bib_phase_highlight_capture', {
        sessionId,
        requestId,
      });
      const payload = await resultP;
      if (payload?.error) return { ok: false, skipped: String(payload.error) };
      if (!payload?.pngBase64) return { ok: false, skipped: 'no_png' };
      buffer = Buffer.from(payload.pngBase64, 'base64');
      meta = payload?.meta || null;
    } else {
      const local = getAttachedCdpClient();
      if (!local) return { ok: false, skipped: 'no_cdp' };
      const captured = await runPhaseScreenshotCapture(local);
      buffer = captured.buffer;
      meta = captured.meta;
    }

    const metadata = buildMetadata(buffer, meta);
    const screenshotId = await replacePhaseHighlightScreenshot(phaseId, {
      trajectoryId,
      buffer,
      mimeType: 'image/png',
      metadataJson: JSON.stringify(metadata),
    });
    if (screenshotId) {
      await trajectoryPhaseDao.update(phaseId, { stitchScreenshotId: screenshotId });
    }
    return { ok: true, screenshotId, elementCount: metadata.elements.length };
  } catch (err) {
    return wrapCaptureError(err);
  }
}
