import * as screenshotDao from '../dao/screenshot-dao.js';
import {
  uploadScreenshot,
  getScreenshotBuffer,
  getPresignedUrl,
  removeScreenshotObject,
  removeScreenshotObjectStrict,
  isMinioConfigured,
} from './minio-service.js';
import {
  createPendingFile,
  commitPendingFile,
  readPendingFile,
  deletePendingFile,
} from './screenshot-pending-store.js';
import { getDB } from '../../config/database.js';

async function uploadOrThrow(buffer, mimeType) {
  if (!isMinioConfigured()) {
    throw new Error('MinIO is not configured; cannot store screenshot');
  }
  return uploadScreenshot(buffer, { mimeType });
}

async function removeStoredObject(row, { strict = false } = {}) {
  if (!row) return;
  if (row.storageType === 'minio' && row.storagePath) {
    if (strict) {
      await removeScreenshotObjectStrict(row.storagePath);
    } else {
      await removeScreenshotObject(row.storagePath);
    }
    return;
  }
  if (row.storageType === 'local' && row.id) {
    await deletePendingFile(row.id);
  }
}

async function fallbackToLocal({ daoCall, pendingFile }) {
  try {
    const id = await daoCall({
      storageType: 'local',
      storagePath: null,
      imageUrl: null,
      retryCount: 0,
      lastRetryAt: null,
    });
    if (id) {
      await commitPendingFile(pendingFile.filePath, id);
      return id;
    }
  } catch (dbErr) {
    console.warn('[screenshot] local fallback DB write failed:', dbErr?.message || dbErr);
  }
  await deletePendingFile(pendingFile.filePath).catch(() => {});
  throw new Error('Screenshot upload failed and local fallback could not be persisted');
}

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
  const existing = await screenshotDao.findByStepAndKind(stepId, kind);
  await removeStoredObject(existing, { strict: true });

  const pendingFile = await createPendingFile(buf);
  const daoCall = (storageFields) => screenshotDao.replaceForStep({
    trajectoryStepId: stepId,
    trajectoryId: trajectoryId != null ? Number(trajectoryId) : null,
    kind,
    fileSize: buf.length,
    mimeType: 'image/png',
    ...storageFields,
  });

  let uploaded;
  try {
    uploaded = await uploadOrThrow(buf, 'image/png');
  } catch (uploadErr) {
    console.warn('[screenshot] MinIO upload failed, keeping local copy:', uploadErr?.message || uploadErr);
    return fallbackToLocal({ daoCall, pendingFile });
  }

  let id;
  try {
    id = await daoCall({
      storageType: uploaded.storageType,
      storagePath: uploaded.storagePath,
      imageUrl: uploaded.imageUrl,
      retryCount: 0,
      lastRetryAt: null,
    });
  } catch (err) {
    await removeScreenshotObject(uploaded.storagePath).catch(() => {});
    await deletePendingFile(pendingFile.filePath).catch(() => {});
    throw err;
  }
  await deletePendingFile(pendingFile.filePath).catch(() => {});
  return id;
}

export async function replacePhaseHighlightScreenshot(trajectoryPhaseId, {
  trajectoryId = null,
  buffer,
  mimeType = 'image/png',
  metadataJson = null,
} = {}) {
  const phaseId = Number(trajectoryPhaseId);
  if (!Number.isFinite(phaseId) || phaseId <= 0) throw new Error('trajectoryPhaseId required');
  if (!buffer || !buffer.length) throw new Error('buffer required');
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  const existing = await screenshotDao.findByPhaseAndKind(phaseId);
  await removeStoredObject(existing, { strict: true });

  const pendingFile = await createPendingFile(buf);
  const daoCall = (storageFields) => screenshotDao.replaceForPhase({
    trajectoryPhaseId: phaseId,
    trajectoryId: trajectoryId != null ? Number(trajectoryId) : null,
    fileSize: buf.length,
    mimeType,
    metadataJson,
    ...storageFields,
  });

  let uploaded;
  try {
    uploaded = await uploadOrThrow(buf, mimeType);
  } catch (uploadErr) {
    console.warn('[screenshot] MinIO phase screenshot upload failed, keeping local copy:', uploadErr?.message || uploadErr);
    return fallbackToLocal({ daoCall, pendingFile });
  }

  let id;
  try {
    id = await daoCall({
      storageType: uploaded.storageType,
      storagePath: uploaded.storagePath,
      imageUrl: uploaded.imageUrl,
      retryCount: 0,
      lastRetryAt: null,
    });
  } catch (err) {
    await removeScreenshotObject(uploaded.storagePath).catch(() => {});
    await deletePendingFile(pendingFile.filePath).catch(() => {});
    throw err;
  }
  await deletePendingFile(pendingFile.filePath).catch(() => {});
  return id;
}

export async function replaceDialogScreenshot(trajectoryStepId, {
  trajectoryId = null,
  buffer,
  mimeType = 'image/png',
  metadataJson = null,
} = {}) {
  const stepId = Number(trajectoryStepId);
  if (!Number.isFinite(stepId) || stepId <= 0) throw new Error('trajectoryStepId required');
  if (!buffer || !buffer.length) throw new Error('buffer required');
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  const existing = await screenshotDao.findByStepAndKind(stepId, 'phase_highlight');
  await removeStoredObject(existing, { strict: true });

  const pendingFile = await createPendingFile(buf);
  const daoCall = (storageFields) => screenshotDao.replaceDialogForStep({
    trajectoryStepId: stepId,
    trajectoryId: trajectoryId != null ? Number(trajectoryId) : null,
    fileSize: buf.length,
    mimeType,
    metadataJson,
    ...storageFields,
  });

  let uploaded;
  try {
    uploaded = await uploadOrThrow(buf, mimeType);
  } catch (uploadErr) {
    console.warn('[screenshot] MinIO dialog upload failed, keeping local copy:', uploadErr?.message || uploadErr);
    return fallbackToLocal({ daoCall, pendingFile });
  }

  let id;
  try {
    id = await daoCall({
      storageType: uploaded.storageType,
      storagePath: uploaded.storagePath,
      imageUrl: uploaded.imageUrl,
      retryCount: 0,
      lastRetryAt: null,
    });
  } catch (err) {
    await removeScreenshotObject(uploaded.storagePath).catch(() => {});
    await deletePendingFile(pendingFile.filePath).catch(() => {});
    throw err;
  }
  await deletePendingFile(pendingFile.filePath).catch(() => {});
  return id;
}

export async function getScreenshotImage(id) {
  const row = await screenshotDao.getImage(id);
  if (!row) return null;

  if (row.storage_type === 'minio' && row.storage_path) {
    const buffer = await getScreenshotBuffer(row.storage_path);
    return {
      id: row.id,
      buffer,
      mimeType: row.mime_type || 'image/png',
      fileSize: buffer.length,
      imageUrl: row.image_url || `/api/v2/screenshots/${id}/image`,
      storageType: row.storage_type,
    };
  }

  if (row.storage_type === 'local') {
    const buffer = await readPendingFile(row.id);
    if (!buffer) {
      throw new Error(`Screenshot ${id} local pending file not found`);
    }
    return {
      id: row.id,
      buffer,
      mimeType: row.mime_type || 'image/png',
      fileSize: buffer.length,
      imageUrl: `/api/v2/screenshots/${id}/image`,
      storageType: row.storage_type,
    };
  }

  throw new Error(`Screenshot ${id} has no valid storage (storage_type=${row.storage_type || 'db'})`);
}

export async function listByTrajectory(trajectoryId) {
  const list = await screenshotDao.listByTrajectory(trajectoryId);
  return Promise.all(list.map(async (item) => {
    if (item.storageType === 'minio' && item.storagePath) {
      const presigned = await getPresignedUrl(item.storagePath).catch(() => null);
      return {
        ...item,
        imageUrl: presigned || item.imageUrl || `/api/v2/screenshots/${item.id}/image`,
      };
    }
    return {
      ...item,
      imageUrl: item.imageUrl || `/api/v2/screenshots/${item.id}/image`,
    };
  }));
}

export async function listPendingScreenshots() {
  const list = await screenshotDao.listPending();
  return list.map((item) => ({
    ...item,
    imageUrl: `/api/v2/screenshots/${item.id}/image`,
  }));
}

export async function listDialogScreenshotsByTrajectory(trajectoryId) {
  return screenshotDao.listDialogScreenshotsByTrajectory(trajectoryId);
}

export async function getScreenshotUrl(id) {
  const row = await screenshotDao.getImage(id);
  if (!row) return null;
  if (row.storage_type === 'minio' && row.storage_path) {
    const presigned = await getPresignedUrl(row.storage_path).catch(() => null);
    return presigned || row.image_url || `/api/v2/screenshots/${id}/image`;
  }
  return row.image_url || `/api/v2/screenshots/${id}/image`;
}

export async function deleteScreenshot(id) {
  const row = await screenshotDao.getImage(id);
  if (!row) return false;
  if (row.storage_type === 'minio' && row.storage_path) {
    await removeScreenshotObjectStrict(row.storage_path);
  } else if (row.storage_type === 'local') {
    await deletePendingFile(row.id);
  }
  if (row.kind === 'phase_highlight' && row.trajectory_phase_id) {
    await getDB()('trajectory_phase')
      .where({ id: row.trajectory_phase_id })
      .update({ stitch_screenshot_id: null });
  }
  await screenshotDao.remove(id);
  return true;
}

export async function deleteScreenshotsByStepIds(stepIds) {
  const rows = await screenshotDao.listByStepIds(stepIds);
  await Promise.all(rows.map((r) => removeStoredObject(r).catch((err) => {
    console.warn('[screenshot] delete step object failed:', err?.message || err);
  })));
  return rows.length;
}

export async function deleteScreenshotsByPhaseIds(phaseIds) {
  const rows = await screenshotDao.listByPhaseIds(phaseIds);
  await Promise.all(rows.map((r) => removeStoredObject(r).catch((err) => {
    console.warn('[screenshot] delete phase object failed:', err?.message || err);
  })));
  return rows.length;
}

export async function deleteScreenshotsByTrajectory(trajectoryId) {
  const rows = await screenshotDao.listStorageByTrajectory(trajectoryId);
  await Promise.all(rows.map((r) => removeStoredObject(r).catch((err) => {
    console.warn('[screenshot] delete trajectory object failed:', err?.message || err);
  })));
  return rows.length;
}
