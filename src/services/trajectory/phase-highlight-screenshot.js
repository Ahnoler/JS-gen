import { randomUUID } from 'node:crypto';
import * as trajectoryStepDao from '../../dao/trajectory-step-dao.js';
import * as trajectoryPhaseDao from '../../dao/trajectory-phase-dao.js';
import { collectHighlightTargets } from '../../models/phase-highlight-targets.js';
import { runPhaseHighlightCapture } from '../../cdp/phase-highlight-capture.js';
import { replacePhaseHighlightScreenshot } from '../screenshot-service.js';
import { USE_EXECUTOR } from '../../../config/config.js';
import * as execSession from '../../executor-session-client.js';
import { getAttachedCdpClient } from '../../cdp/remote-bridge.js';

export function wrapCaptureError(err) {
  console.warn('[record] phase highlight screenshot skipped:', err?.message || err);
  return { ok: false, skipped: String(err?.message || err || 'error') };
}

export async function capturePhaseHighlightScreenshot({
  trajectoryId,
  phaseId,
  cdpClient,
  sessionId,
  executorNodeUuid,
} = {}) {
  try {
    const steps = await trajectoryStepDao.listByPhase(phaseId);
    const targets = collectHighlightTargets(steps);

    let buffer;
    let hitCount = 0;

    if (cdpClient) {
      const captured = await runPhaseHighlightCapture(cdpClient, targets);
      buffer = captured.buffer;
      hitCount = captured.hitCount;
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
        targets,
      });
      const payload = await resultP;
      if (payload?.error) return { ok: false, skipped: String(payload.error) };
      if (!payload?.pngBase64) return { ok: false, skipped: 'no_png' };
      buffer = Buffer.from(payload.pngBase64, 'base64');
      hitCount = Number(payload.hitCount) || 0;
    } else {
      const local = getAttachedCdpClient();
      if (!local) return { ok: false, skipped: 'no_cdp' };
      const captured = await runPhaseHighlightCapture(local, targets);
      buffer = captured.buffer;
      hitCount = captured.hitCount;
    }

    const screenshotId = await replacePhaseHighlightScreenshot(phaseId, {
      trajectoryId,
      buffer,
      mimeType: 'image/png',
    });
    if (screenshotId) {
      await trajectoryPhaseDao.update(phaseId, { stitchScreenshotId: screenshotId });
    }
    return { ok: true, screenshotId, hitCount };
  } catch (err) {
    return wrapCaptureError(err);
  }
}
