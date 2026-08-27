/**
 * Screenshot storage service: replace step/phase/page-level screenshots,
 * serve images, list pending, and bulk-upload local-pending to MinIO.
 */
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

/**
 * Replace (upsert) the before/after screenshot for a trajectory step.
 * @param {number} trajectoryStepId step DB id
 * @param {object} [root0] options
 * @param {number|null} [root0.trajectoryId] trajectory DB id
 * @param {'before'|'after'} root0.kind screenshot kind
 * @param {Buffer} root0.buffer image bytes
 * @returns {Promise<number>} screenshot row id
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

/**
 * Replace (upsert) the phase-highlight screenshot for a trajectory phase.
 * @param {number} trajectoryPhaseId phase DB id
 * @param {object} [root0] options
 * @param {number|null} [root0.trajectoryId] trajectory DB id
 * @param {Buffer} root0.buffer image bytes
 * @param {string} [root0.mimeType] MIME type, default image/png
 * @param {string|null} [root0.metadataJson] extra metadata JSON
 * @returns {Promise<number>} screenshot row id
 */
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

/**
 * Replace (upsert) a phase-group screenshot for a trajectory phase × state-group.
 * Same state_group replaces the old row (uk_ss_phase_group), keeping step bindings stable.
 * @param {number} trajectoryPhaseId phase DB id
 * @param {object} [root0] options
 * @param {number|null} [root0.trajectoryId] trajectory DB id
 * @param {string} root0.stateGroup state-group key (current_page_level level key)
 * @param {Buffer} root0.buffer image bytes
 * @param {string} [root0.mimeType] MIME type, default image/png
 * @param {string|null} [root0.metadataJson] extra metadata JSON
 * @returns {Promise<number>} screenshot row id
 */
export async function replacePhaseGroupScreenshot(trajectoryPhaseId, {
  trajectoryId = null,
  stateGroup = '',
  buffer,
  mimeType = 'image/png',
  metadataJson = null,
} = {}) {
  const phaseId = Number(trajectoryPhaseId);
  if (!Number.isFinite(phaseId) || phaseId <= 0) throw new Error('trajectoryPhaseId required');
  if (!String(stateGroup || '').trim()) throw new Error('stateGroup required');
  if (!buffer || !buffer.length) throw new Error('buffer required');
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  const existing = await screenshotDao.findByPhaseAndStateGroup(phaseId, stateGroup);
  await removeStoredObject(existing, { strict: true });

  const pendingFile = await createPendingFile(buf);
  const daoCall = (storageFields) => screenshotDao.replaceForPhaseGroup({
    trajectoryPhaseId: phaseId,
    trajectoryId: trajectoryId != null ? Number(trajectoryId) : null,
    stateGroup: String(stateGroup),
    fileSize: buf.length,
    mimeType,
    metadataJson,
    ...storageFields,
  });

  let uploaded;
  try {
    uploaded = await uploadOrThrow(buf, mimeType);
  } catch (uploadErr) {
    console.warn('[screenshot] MinIO phase-group upload failed, keeping local copy:', uploadErr?.message || uploadErr);
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

/**
 * Find the phase-group screenshot row for one phase × state-group.
 * @param {number} phaseId phase DB id
 * @param {string} stateGroup state-group key
 * @returns {Promise<object|null>} screenshot row or null
 */
export async function findPhaseGroupByStateGroup(phaseId, stateGroup) {
  return screenshotDao.findByPhaseAndStateGroup(phaseId, stateGroup);
}

/**
 * List phase-group screenshots of a trajectory (kind='phase_group'), ordered by id.
 * @param {number} trajectoryId trajectory DB id
 * @returns {Promise<Array<object>>} phase-group screenshot rows
 */
export async function listPhaseGroupsByTrajectory(trajectoryId) {
  return screenshotDao.listPhaseGroupsByTrajectory(trajectoryId);
}

/**
 * Replace (upsert) the dialog screenshot for a trajectory step.
 * @param {number} trajectoryStepId step DB id
 * @param {object} [root0] options
 * @param {number|null} [root0.trajectoryId] trajectory DB id
 * @param {Buffer} root0.buffer image bytes
 * @param {string} [root0.mimeType] MIME type, default image/png
 * @param {string|null} [root0.metadataJson] extra metadata JSON
 * @returns {Promise<number>} screenshot row id
 */
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

/**
 * Replace (upsert) a page-level screenshot (e.g. full-page / tab / drawer).
 * @param {object} [root0] options
 * @param {number|null} [root0.trajectoryId] trajectory DB id
 * @param {string} [root0.levelType] level type, default 'page'
 * @param {string} [root0.levelKey] unique level key within the trajectory
 * @param {string|null} [root0.parentLevelKey] parent level key
 * @param {Buffer} root0.buffer image bytes
 * @param {string} [root0.mimeType] MIME type, default image/png
 * @param {string|null} [root0.metadataJson] extra metadata JSON
 * @returns {Promise<number>} screenshot row id
 */
export async function replacePageLevelScreenshot({
  trajectoryId = null,
  levelType = 'page',
  levelKey = '',
  parentLevelKey = null,
  buffer,
  mimeType = 'image/png',
  metadataJson = null,
} = {}) {
  const trajId = Number(trajectoryId);
  if (!Number.isFinite(trajId) || trajId <= 0) throw new Error('trajectoryId required');
  if (!levelKey) throw new Error('levelKey required');
  if (!buffer || !buffer.length) throw new Error('buffer required');
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  const existing = await screenshotDao.findPageLevel(trajId, levelKey);
  await removeStoredObject(existing, { strict: true });

  const pendingFile = await createPendingFile(buf);
  const daoCall = (storageFields) => screenshotDao.replacePageLevel({
    trajectoryId: trajId,
    levelType,
    levelKey: String(levelKey),
    parentLevelKey,
    fileSize: buf.length,
    mimeType,
    metadataJson,
    ...storageFields,
  });

  let uploaded;
  try {
    uploaded = await uploadOrThrow(buf, mimeType);
  } catch (uploadErr) {
    console.warn('[screenshot] MinIO page-level upload failed, keeping local copy:', uploadErr?.message || uploadErr);
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

/**
 * List page-level screenshots for a trajectory.
 * @param {number} trajectoryId trajectory DB id
 * @returns {Promise<Array<object>>} page-level screenshot rows
 */
export async function listPageLevelScreenshotsByTrajectory(trajectoryId) {
  return screenshotDao.listPageLevelByTrajectory(trajectoryId);
}

/**
 * Load a screenshot image (buffer + mime) from MinIO or local pending store.
 * @param {number} id screenshot DB id
 * @returns {Promise<object|null>} image payload or null if not found
 */
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

/**
 * List screenshots for a trajectory (with presigned MinIO URLs).
 * @param {number} trajectoryId trajectory DB id
 * @returns {Promise<Array<object>>} screenshot rows with image URLs
 */
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

/**
 * List local-pending screenshots (not yet uploaded to MinIO).
 * @returns {Promise<Array<object>>} pending screenshot rows with image URLs
 */
export async function listPendingScreenshots() {
  const list = await screenshotDao.listPending();
  return list.map((item) => ({
    ...item,
    imageUrl: `/api/v2/screenshots/${item.id}/image`,
  }));
}

/**
 * One-click bulk upload of all local-pending screenshots to MinIO.
 * Delegates to the background retry pass (same upload + DB-mark + cleanup logic)
 * but runs immediately, ignoring the per-row retry interval so the operator can
 * force a flush from the API docs page.
 * @returns {Promise<{scanned:number,uploaded:number,failed:number,skipped:number}>} bulk upload stats
 */
export async function uploadPendingScreenshots() {
  const { retryPendingScreenshots } = await import('./screenshot-pending-retry.js');
  // Force every pending row to be attempted now: pass a 0 interval so the
  // "last retry too recent" guard never skips, and a high maxRetry so exhausted
  // rows still get a chance when triggered manually.
  return retryPendingScreenshots({ intervalMs: 0, maxRetry: Number.MAX_SAFE_INTEGER });
}

/**
 * Upload a single pending screenshot by id. Used by per-row actions in the docs UI.
 * @param {number} id screenshot DB id
 * @returns {Promise<{id:number,status:'uploaded'|'not_pending'|'not_found',storagePath?:string,imageUrl?:string}>} upload result
 */
export async function uploadPendingScreenshot(id) {
  const numeric = Number(id);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error('Numeric screenshot id required');
  }
  const row = await screenshotDao.getImage(numeric);
  if (!row) return { id: numeric, status: 'not_found' };
  if (row.storage_type !== 'local') return { id: numeric, status: 'not_pending' };

  const buffer = await readPendingFile(row.id);
  if (!buffer) throw new Error(`Screenshot ${numeric} local pending file not found`);

  const uploaded = await uploadScreenshot(buffer, {
    mimeType: row.mime_type || 'image/png',
  });
  try {
    await screenshotDao.markUploaded(row.id, {
      storagePath: uploaded.storagePath,
      imageUrl: uploaded.imageUrl,
    });
  } catch (err) {
    // DB update failed: roll back the MinIO object so we don't leak it.
    await removeScreenshotObject(uploaded.storagePath).catch(() => {});
    throw err;
  }
  await deletePendingFile(row.id).catch(() => {});
  return {
    id: numeric,
    status: 'uploaded',
    storagePath: uploaded.storagePath,
    imageUrl: uploaded.imageUrl,
  };
}

/**
 * List dialog screenshots for a trajectory.
 * @param {number} trajectoryId trajectory DB id
 * @returns {Promise<Array<object>>} dialog screenshot rows
 */
export async function listDialogScreenshotsByTrajectory(trajectoryId) {
  return screenshotDao.listDialogScreenshotsByTrajectory(trajectoryId);
}

/**
 * Get a presigned/relative URL for a screenshot by id.
 * @param {number} id screenshot DB id
 * @returns {Promise<string|null>} image URL or null if not found
 */
export async function getScreenshotUrl(id) {
  const row = await screenshotDao.getImage(id);
  if (!row) return null;
  if (row.storage_type === 'minio' && row.storage_path) {
    const presigned = await getPresignedUrl(row.storage_path).catch(() => null);
    return presigned || row.image_url || `/api/v2/screenshots/${id}/image`;
  }
  return row.image_url || `/api/v2/screenshots/${id}/image`;
}

/**
 * Delete a screenshot (MinIO object or local pending file) + DB row.
 * @param {number} id screenshot DB id
 * @returns {Promise<boolean>} true if deleted, false if not found
 */
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

/**
 * Delete screenshots bound to the given step ids (objects + DB rows).
 * @param {number[]} stepIds step DB ids
 * @returns {Promise<number>} count of deleted screenshot rows
 */
export async function deleteScreenshotsByStepIds(stepIds) {
  const rows = await screenshotDao.listByStepIds(stepIds);
  await Promise.all(rows.map((r) => removeStoredObject(r).catch((err) => {
    console.warn('[screenshot] delete step object failed:', err?.message || err);
  })));
  return rows.length;
}

/**
 * Delete screenshots bound to the given phase ids (objects + DB rows).
 * @param {number[]} phaseIds phase DB ids
 * @returns {Promise<number>} count of deleted screenshot rows
 */
export async function deleteScreenshotsByPhaseIds(phaseIds) {
  const rows = await screenshotDao.listByPhaseIds(phaseIds);
  await Promise.all(rows.map((r) => removeStoredObject(r).catch((err) => {
    console.warn('[screenshot] delete phase object failed:', err?.message || err);
  })));
  return rows.length;
}

/**
 * Delete all screenshots for a trajectory (objects + DB rows).
 * @param {number} trajectoryId trajectory DB id
 * @returns {Promise<number>} count of deleted screenshot rows
 */
export async function deleteScreenshotsByTrajectory(trajectoryId) {
  const rows = await screenshotDao.listStorageByTrajectory(trajectoryId);
  await Promise.all(rows.map((r) => removeStoredObject(r).catch((err) => {
    console.warn('[screenshot] delete trajectory object failed:', err?.message || err);
  })));
  return rows.length;
}
