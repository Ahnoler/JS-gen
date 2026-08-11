import * as screenshotDao from '../dao/screenshot-dao.js';

/**
 * UPSERT one before/after screenshot for a trajectory step.
 * @param {number} trajectoryStepId
 * @param {{ trajectoryId?: number|null, kind: 'before'|'after', buffer: Buffer|Uint8Array }} opts
 */
export async function replaceStepScreenshot(trajectoryStepId, {
  trajectoryId = null,
  kind,
  buffer,
} = {}) {
  const stepId = Number(trajectoryStepId);
  if (!Number.isFinite(stepId) || stepId <= 0) throw new Error('trajectoryStepId required');
  if (kind !== 'before' && kind !== 'after') throw new Error('kind must be before|after');
  if (!buffer || !buffer.length) throw new Error('buffer required');

  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return screenshotDao.replaceForStep({
    trajectoryStepId: stepId,
    trajectoryId: trajectoryId != null ? Number(trajectoryId) : null,
    kind,
    imageData: buf,
    fileSize: buf.length,
    mimeType: 'image/png',
  });
}

export async function getScreenshotImage(id) {
  return screenshotDao.getImage(id);
}

export async function listByTrajectory(trajectoryId) {
  return screenshotDao.listByTrajectory(trajectoryId);
}
