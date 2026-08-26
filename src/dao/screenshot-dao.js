/**
 * DAO for the `screenshot` table — step/phase/page-level screenshot storage with UPSERT and retry tracking.
 */
import { getDB } from '../../config/database.js';

import { fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'screenshot';

const META_COLS = [
  'screenshot.id',
  'screenshot.storage_type',
  'screenshot.retry_count',
  'screenshot.last_retry_at',
  'screenshot.storage_path',
  'screenshot.image_url',
  'screenshot.file_size',
  'screenshot.mime_type',
  'screenshot.trajectory_id',
  'screenshot.trajectory_step_id',
  'screenshot.trajectory_phase_id',
  'screenshot.kind',
  'screenshot.level_type',
  'screenshot.level_key',
  'screenshot.parent_level_key',
  'screenshot.metadata_json',
  'screenshot.created_at',
];

function defaultImageUrl(id, imageUrl) {
  return imageUrl || `/api/v2/screenshots/${id}/image`;
}

async function updateImageUrlIfMissing(db, id, imageUrl) {
  if (!id) return;
  const url = imageUrl || `/api/v2/screenshots/${id}/image`;
  await db(TABLE).where({ id }).update({ image_url: url });
}

/**
 * UPSERT one screenshot row by (trajectory_step_id, kind).
 * @param {object} screenshot camelCase screenshot fields (trajectoryStepId required)
 * @returns {Promise<number|null>} row id, or null if step no longer exists
 */
export async function replaceForStep(screenshot) {
  const stepId = screenshot.trajectoryStepId != null ? Number(screenshot.trajectoryStepId) : null;
  const kind = screenshot.kind === 'before' ? 'before' : 'after';
  if (!Number.isFinite(stepId) || stepId <= 0) {
    throw new Error('trajectoryStepId required for replaceForStep');
  }

  const storageType = screenshot.storageType || 'minio';
  const storagePath = screenshot.storagePath || null;
  const imageUrl = screenshot.imageUrl || null;
  const fileSize = screenshot.fileSize || 0;
  const mimeType = screenshot.mimeType || 'image/png';
  const trajectoryId = screenshot.trajectoryId != null ? Number(screenshot.trajectoryId) : null;
  const retryCount = screenshot.retryCount ?? 0;
  const lastRetryAt = screenshot.lastRetryAt ?? null;

  const db = getDB();
  const stepExists = await db('trajectory_step').where({ id: stepId }).first('id');
  if (!stepExists) {
    const err = new Error(`trajectory_step ${stepId} not found`);
    err.errno = 1452;
    err.code = 'ER_NO_REFERENCED_ROW_2';
    err.sqlMessage = `trajectory_step ${stepId} not found (coalesce/remove race)`;
    throw err;
  }

  await db.raw(
    `INSERT INTO \`${TABLE}\`
      (storage_type, retry_count, last_retry_at, storage_path, image_url, file_size, mime_type, trajectory_id, trajectory_step_id, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      storage_type = VALUES(storage_type),
      retry_count = VALUES(retry_count),
      last_retry_at = VALUES(last_retry_at),
      storage_path = VALUES(storage_path),
      image_url = VALUES(image_url),
      file_size = VALUES(file_size),
      mime_type = VALUES(mime_type),
      trajectory_id = VALUES(trajectory_id)`,
    [storageType, retryCount, lastRetryAt, storagePath, imageUrl, fileSize, mimeType, trajectoryId, stepId, kind],
  );

  const row = await db(TABLE)
    .select('id')
    .where({ trajectory_step_id: stepId, kind })
    .first();
  const id = row?.id != null ? Number(row.id) : null;
  await updateImageUrlIfMissing(db, id, imageUrl);
  return id;
}

/**
 * UPSERT one phase_highlight screenshot row by (trajectory_phase_id, kind).
 * @param {object} screenshot camelCase screenshot fields (trajectoryPhaseId required)
 * @returns {Promise<number|null>} row id, or null if phase no longer exists
 */
export async function replaceForPhase(screenshot) {
  const phaseId = screenshot.trajectoryPhaseId != null ? Number(screenshot.trajectoryPhaseId) : null;
  const kind = 'phase_highlight';
  if (!Number.isFinite(phaseId) || phaseId <= 0) {
    throw new Error('trajectoryPhaseId required for replaceForPhase');
  }

  const storageType = screenshot.storageType || 'minio';
  const storagePath = screenshot.storagePath || null;
  const imageUrl = screenshot.imageUrl || null;
  const fileSize = screenshot.fileSize || 0;
  const mimeType = screenshot.mimeType || 'image/png';
  const trajectoryId = screenshot.trajectoryId != null ? Number(screenshot.trajectoryId) : null;
  const metadataJson = screenshot.metadataJson ?? null;
  const retryCount = screenshot.retryCount ?? 0;
  const lastRetryAt = screenshot.lastRetryAt ?? null;

  const db = getDB();
  const phaseExists = await db('trajectory_phase').where({ id: phaseId }).first('id');
  if (!phaseExists) {
    const err = new Error(`trajectory_phase ${phaseId} not found`);
    err.code = 'ER_NO_REFERENCED_ROW_2';
    throw err;
  }

  await db.raw(
    `INSERT INTO \`${TABLE}\`
      (storage_type, retry_count, last_retry_at, storage_path, image_url, file_size, mime_type, trajectory_id, trajectory_step_id, trajectory_phase_id, kind, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      storage_type = VALUES(storage_type),
      retry_count = VALUES(retry_count),
      last_retry_at = VALUES(last_retry_at),
      storage_path = VALUES(storage_path),
      image_url = VALUES(image_url),
      file_size = VALUES(file_size),
      mime_type = VALUES(mime_type),
      trajectory_id = VALUES(trajectory_id),
      metadata_json = VALUES(metadata_json)`,
    [storageType, retryCount, lastRetryAt, storagePath, imageUrl, fileSize, mimeType, trajectoryId, phaseId, kind, metadataJson],
  );

  const row = await db(TABLE)
    .select('id')
    .where({ trajectory_phase_id: phaseId, kind })
    .first();
  const id = row?.id != null ? Number(row.id) : null;
  await updateImageUrlIfMissing(db, id, imageUrl);
  return id;
}

/**
 * UPSERT one dialog screenshot row by (trajectory_step_id, kind='phase_highlight').
 * Dialog screenshots reuse phase_highlight kind and are distinguished by metadata_json.dialog=true.
 * @param {object} screenshot camelCase screenshot fields (trajectoryStepId required)
 * @returns {Promise<number|null>} row id, or null if step no longer exists
 */
export async function replaceDialogForStep(screenshot) {
  const stepId = screenshot.trajectoryStepId != null ? Number(screenshot.trajectoryStepId) : null;
  const kind = 'phase_highlight';
  if (!Number.isFinite(stepId) || stepId <= 0) {
    throw new Error('trajectoryStepId required for replaceDialogForStep');
  }

  const storageType = screenshot.storageType || 'minio';
  const storagePath = screenshot.storagePath || null;
  const imageUrl = screenshot.imageUrl || null;
  const fileSize = screenshot.fileSize || 0;
  const mimeType = screenshot.mimeType || 'image/png';
  const trajectoryId = screenshot.trajectoryId != null ? Number(screenshot.trajectoryId) : null;
  const metadataJson = screenshot.metadataJson ?? null;
  const retryCount = screenshot.retryCount ?? 0;
  const lastRetryAt = screenshot.lastRetryAt ?? null;

  const db = getDB();
  const stepExists = await db('trajectory_step').where({ id: stepId }).first('id');
  if (!stepExists) {
    const err = new Error(`trajectory_step ${stepId} not found`);
    err.errno = 1452;
    err.code = 'ER_NO_REFERENCED_ROW_2';
    err.sqlMessage = `trajectory_step ${stepId} not found (coalesce/remove race)`;
    throw err;
  }

  await db.raw(
    `INSERT INTO \`${TABLE}\`
      (storage_type, retry_count, last_retry_at, storage_path, image_url, file_size, mime_type, trajectory_id, trajectory_step_id, trajectory_phase_id, kind, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
     ON DUPLICATE KEY UPDATE
      storage_type = VALUES(storage_type),
      retry_count = VALUES(retry_count),
      last_retry_at = VALUES(last_retry_at),
      storage_path = VALUES(storage_path),
      image_url = VALUES(image_url),
      file_size = VALUES(file_size),
      mime_type = VALUES(mime_type),
      trajectory_id = VALUES(trajectory_id),
      metadata_json = VALUES(metadata_json)`,
    [storageType, retryCount, lastRetryAt, storagePath, imageUrl, fileSize, mimeType, trajectoryId, stepId, kind, metadataJson],
  );

  const row = await db(TABLE)
    .select('id')
    .where({ trajectory_step_id: stepId, kind })
    .first();
  const id = row?.id != null ? Number(row.id) : null;
  await updateImageUrlIfMissing(db, id, imageUrl);
  return id;
}

/**
 * UPSERT one page-level screenshot row by (trajectory_id, kind='page_level', level_key).
 * Page-level screenshots are not bound to a single trajectory_phase/step;
 * source phase/step ids are recorded in metadata_json for diagnostics.
 * @param {object} screenshot camelCase screenshot fields (trajectoryId/levelKey required)
 * @returns {Promise<number|null>} row id, or null if trajectory no longer exists
 */
export async function replacePageLevel(screenshot) {
  const trajectoryId = screenshot.trajectoryId != null ? Number(screenshot.trajectoryId) : null;
  const levelType = screenshot.levelType === 'popup' ? 'popup' : 'page';
  const levelKey = String(screenshot.levelKey || '').trim();
  const parentLevelKey = screenshot.parentLevelKey ? String(screenshot.parentLevelKey).trim() : null;
  const kind = 'page_level';
  if (!Number.isFinite(trajectoryId) || trajectoryId <= 0) {
    throw new Error('trajectoryId required for replacePageLevel');
  }
  if (!levelKey) {
    throw new Error('levelKey required for replacePageLevel');
  }

  const storageType = screenshot.storageType || 'minio';
  const storagePath = screenshot.storagePath || null;
  const imageUrl = screenshot.imageUrl || null;
  const fileSize = screenshot.fileSize || 0;
  const mimeType = screenshot.mimeType || 'image/png';
  const metadataJson = screenshot.metadataJson ?? null;
  const retryCount = screenshot.retryCount ?? 0;
  const lastRetryAt = screenshot.lastRetryAt ?? null;

  const db = getDB();
  const trajExists = await db('trajectory').where({ id: trajectoryId }).first('id');
  if (!trajExists) {
    const err = new Error(`trajectory ${trajectoryId} not found`);
    err.code = 'ER_NO_REFERENCED_ROW_2';
    throw err;
  }

  await db.raw(
    `INSERT INTO \`${TABLE}\`
      (storage_type, retry_count, last_retry_at, storage_path, image_url, file_size, mime_type, trajectory_id, trajectory_step_id, trajectory_phase_id, kind, level_type, level_key, parent_level_key, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      storage_type = VALUES(storage_type),
      retry_count = VALUES(retry_count),
      last_retry_at = VALUES(last_retry_at),
      storage_path = VALUES(storage_path),
      image_url = VALUES(image_url),
      file_size = VALUES(file_size),
      mime_type = VALUES(mime_type),
      level_type = VALUES(level_type),
      parent_level_key = VALUES(parent_level_key),
      metadata_json = VALUES(metadata_json)`,
    [storageType, retryCount, lastRetryAt, storagePath, imageUrl, fileSize, mimeType, trajectoryId, kind, levelType, levelKey, parentLevelKey, metadataJson],
  );

  const row = await db(TABLE)
    .select('id')
    .where({ trajectory_id: trajectoryId, kind, level_key: levelKey })
    .first();
  const id = row?.id != null ? Number(row.id) : null;
  await updateImageUrlIfMissing(db, id, imageUrl);
  return id;
}

/**
 * List all page-level screenshots for one trajectory (kind='page_level').
 * @param {number} trajectoryId 轨迹 id
 * @returns {Promise<object[]>} page-level screenshot entities with parsed metadataJson
 */
export async function listPageLevelByTrajectory(trajectoryId) {
  const rows = await getDB()(TABLE)
    .select('id', 'trajectory_id', 'level_type', 'level_key', 'parent_level_key', 'metadata_json', 'storage_path', 'storage_type', 'image_url')
    .where({ trajectory_id: trajectoryId, kind: 'page_level' })
    .orderBy('id', 'asc');
  return fromDbRows(rows).map((r) => {
    let metadataJson = null;
    if (r.metadataJson != null && typeof r.metadataJson === 'string') {
      try { metadataJson = JSON.parse(r.metadataJson); } catch { metadataJson = null; }
    } else if (r.metadataJson != null) {
      metadataJson = r.metadataJson;
    }
    return {
      id: r.id,
      trajectoryId: r.trajectoryId,
      levelType: r.levelType,
      levelKey: r.levelKey,
      parentLevelKey: r.parentLevelKey || null,
      metadataJson,
      storagePath: r.storagePath || null,
      storageType: r.storageType || null,
      imageUrl: r.imageUrl || null,
    };
  });
}

/**
 * List phase_highlight screenshots for a trajectory with parsed metadataJson.
 * @param {number} trajectoryId 轨迹 id
 * @returns {Promise<object[]>} phase highlight screenshot entities
 */
export async function listPhaseHighlightsByTrajectory(trajectoryId) {
  const rows = await getDB()(TABLE)
    .select('id', 'trajectory_phase_id', 'metadata_json', 'storage_path', 'storage_type', 'image_url')
    .where({ trajectory_id: trajectoryId, kind: 'phase_highlight' });
  return fromDbRows(rows).map((r) => {
    let metadataJson = null;
    if (r.metadataJson != null && typeof r.metadataJson === 'string') {
      try { metadataJson = JSON.parse(r.metadataJson); } catch { metadataJson = null; }
    } else if (r.metadataJson != null) {
      metadataJson = r.metadataJson;
    }
    return {
      id: r.id,
      trajectoryPhaseId: r.trajectoryPhaseId,
      metadataJson,
      storagePath: r.storagePath || null,
      storageType: r.storageType || null,
      imageUrl: r.imageUrl || null,
    };
  });
}

/**
 * List dialog screenshots (phase_highlight with metadataJson.dialog=true, bound to a step) for a trajectory.
 * @param {number} trajectoryId 轨迹 id
 * @returns {Promise<object[]>} dialog screenshot entities
 */
export async function listDialogScreenshotsByTrajectory(trajectoryId) {
  const rows = await getDB()(TABLE)
    .select('id', 'trajectory_step_id', 'trajectory_phase_id', 'metadata_json', 'storage_path', 'storage_type', 'image_url')
    .where({ trajectory_id: trajectoryId, kind: 'phase_highlight' })
    .whereNull('trajectory_phase_id')
    .whereNotNull('trajectory_step_id');
  return fromDbRows(rows).map((r) => {
    let metadataJson = null;
    if (r.metadataJson != null && typeof r.metadataJson === 'string') {
      try { metadataJson = JSON.parse(r.metadataJson); } catch { metadataJson = null; }
    } else if (r.metadataJson != null) {
      metadataJson = r.metadataJson;
    }
    if (!metadataJson || metadataJson.dialog !== true) return null;
    return {
      id: r.id,
      trajectoryStepId: r.trajectoryStepId,
      trajectoryPhaseId: r.trajectoryPhaseId,
      metadataJson,
      storagePath: r.storagePath || null,
      storageType: r.storageType || null,
      imageUrl: r.imageUrl || null,
    };
  }).filter(Boolean);
}

/**
 * Fetch a screenshot row by id for image serving (storage/metadata columns).
 * @param {number} id 主键
 * @returns {Promise<object|null>} screenshot row or null when not found
 */
export async function getImage(id) {
  const row = await getDB()(TABLE)
    .select(
      'id',
      'storage_type',
      'retry_count',
      'last_retry_at',
      'storage_path',
      'image_url',
      'mime_type',
      'file_size',
      'kind',
      'trajectory_id',
      'trajectory_step_id',
      'trajectory_phase_id',
    )
    .where({ id })
    .first();
  return row || null;
}

/**
 * List screenshots for a trajectory joined with step_number, ordered by step_number then kind.
 * @param {number} trajectoryId 轨迹 id
 * @returns {Promise<object[]>} screenshot entities with stepNumber
 */
export async function listByTrajectory(trajectoryId) {
  const rows = await getDB()(TABLE)
    .select(
      ...META_COLS,
      'trajectory_step.step_number as step_number',
    )
    .leftJoin('trajectory_step', 'screenshot.trajectory_step_id', 'trajectory_step.id')
    .where('screenshot.trajectory_id', trajectoryId)
    .orderBy([
      { column: 'trajectory_step.step_number', order: 'asc' },
      { column: 'screenshot.kind', order: 'asc' },
    ]);
  return fromDbRows(rows);
}

/**
 * Find a screenshot by (trajectory_step_id, kind).
 * @param {number} stepId 步骤 id
 * @param {string} kind screenshot kind ('before'/'after'/...)
 * @returns {Promise<object|null>} screenshot entity or null when not found
 */
export async function findByStepAndKind(stepId, kind) {
  const row = await getDB()(TABLE)
    .select('id', 'storage_type', 'storage_path', 'image_url')
    .where({ trajectory_step_id: Number(stepId), kind })
    .first();
  return fromDbRow(row);
}

/**
 * Find a phase_highlight screenshot by trajectory_phase_id.
 * @param {number} phaseId 阶段 id
 * @returns {Promise<object|null>} screenshot entity or null when not found
 */
export async function findByPhaseAndKind(phaseId) {
  const row = await getDB()(TABLE)
    .select('id', 'storage_type', 'storage_path', 'image_url')
    .where({ trajectory_phase_id: Number(phaseId), kind: 'phase_highlight' })
    .first();
  return fromDbRow(row);
}

/**
 * Find a page-level screenshot by (trajectory_id, level_key).
 * @param {number} trajectoryId 轨迹 id
 * @param {string} levelKey page-level key
 * @returns {Promise<object|null>} screenshot entity or null when not found
 */
export async function findPageLevel(trajectoryId, levelKey) {
  const row = await getDB()(TABLE)
    .select('id', 'storage_type', 'storage_path', 'image_url')
    .where({ trajectory_id: Number(trajectoryId), kind: 'page_level', level_key: String(levelKey || '') })
    .first();
  return fromDbRow(row);
}

/**
 * List screenshots by a set of trajectory_step ids (storage columns only).
 * @param {number[]} stepIds step ids
 * @returns {Promise<object[]>} screenshot entities
 */
export async function listByStepIds(stepIds) {  const ids = [...new Set((stepIds || []).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return [];
  const rows = await getDB()(TABLE)
    .select('id', 'storage_type', 'storage_path', 'image_url')
    .whereIn('trajectory_step_id', ids);
  return fromDbRows(rows);
}

/**
 * List screenshots by a set of trajectory_phase ids (storage columns only).
 * @param {number[]} phaseIds phase ids
 * @returns {Promise<object[]>} screenshot entities
 */
export async function listByPhaseIds(phaseIds) {
  const ids = [...new Set((phaseIds || []).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return [];
  const rows = await getDB()(TABLE)
    .select('id', 'storage_type', 'storage_path', 'image_url')
    .whereIn('trajectory_phase_id', ids);
  return fromDbRows(rows);
}

/**
 * List storage columns for all screenshots of a trajectory.
 * @param {number} trajectoryId 轨迹 id
 * @returns {Promise<object[]>} screenshot storage entities
 */
export async function listStorageByTrajectory(trajectoryId) {
  const rows = await getDB()(TABLE)
    .select('id', 'storage_type', 'storage_path', 'image_url')
    .where({ trajectory_id: trajectoryId });
  return fromDbRows(rows);
}

/**
 * List screenshots pending upload (storage_type='local'), ordered by created_at.
 * @returns {Promise<object[]>} pending screenshot entities
 */
export async function listPending() {
  const rows = await getDB()(TABLE)
    .select(...META_COLS)
    .where({ storage_type: 'local' })
    .orderBy('created_at', 'asc');
  return fromDbRows(rows);
}

/**
 * Mark a screenshot as uploaded to minio (storage_type='minio') and reset retry counters.
 * @param {number} id 主键
 * @param {object} opts 选项
 * @param {string} [opts.storagePath] minio storage path
 * @param {string} [opts.imageUrl] public image URL
 * @returns {Promise<number>} number of updated rows
 */
export async function markUploaded(id, { storagePath, imageUrl }) {
  const numeric = Number(id);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return getDB()(TABLE)
    .where({ id: numeric })
    .update({
      storage_type: 'minio',
      storage_path: storagePath || null,
      image_url: imageUrl || `/api/v2/screenshots/${numeric}/image`,
      retry_count: 0,
      last_retry_at: null,
    });
}

/**
 * Update retry counters for a screenshot (local storage not yet uploaded).
 * @param {number} id 主键
 * @param {object} opts 选项
 * @param {number} opts.retryCount new retry count
 * @param {Date|null} [opts.lastRetryAt] last retry timestamp
 * @returns {Promise<number>} number of updated rows
 */
export async function updateRetry(id, { retryCount, lastRetryAt }) {
  const numeric = Number(id);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return getDB()(TABLE)
    .where({ id: numeric })
    .update({
      retry_count: Number(retryCount) || 0,
      last_retry_at: lastRetryAt || null,
    });
}

/**
 * Delete screenshots by trajectory_step id.
 * @param {number} stepId 步骤 id
 * @returns {Promise<number>} number of deleted rows
 */
export async function removeByTrajectoryStepId(stepId) {
  const id = Number(stepId);
  if (!Number.isFinite(id) || id <= 0) return 0;
  return getDB()(TABLE).where({ trajectory_step_id: id }).del();
}

/**
 * Delete a screenshot by id.
 * @param {number} id 主键
 * @returns {Promise<number>} number of deleted rows
 */
export async function remove(id) {
  return getDB()(TABLE).where({ id }).del();
}
