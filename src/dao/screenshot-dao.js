import { getDB } from '../../config/database.js';
import { fromDbRows } from './helpers.js';

const TABLE = 'screenshot';

const META_COLS = [
  'screenshot.id',
  'screenshot.file_size',
  'screenshot.mime_type',
  'screenshot.trajectory_id',
  'screenshot.trajectory_step_id',
  'screenshot.trajectory_phase_id',
  'screenshot.kind',
  'screenshot.created_at',
];

/**
 * UPSERT one screenshot row by (trajectory_step_id, kind).
 * @returns {Promise<number|null>} row id, or null if step no longer exists
 */
export async function replaceForStep(screenshot) {
  const stepId = screenshot.trajectoryStepId != null ? Number(screenshot.trajectoryStepId) : null;
  const kind = screenshot.kind === 'before' ? 'before' : 'after';
  if (!Number.isFinite(stepId) || stepId <= 0) {
    throw new Error('trajectoryStepId required for replaceForStep');
  }
  const imageData = screenshot.imageData;
  const fileSize = screenshot.fileSize || (imageData ? imageData.length : 0);
  const mimeType = screenshot.mimeType || 'image/png';
  const trajectoryId = screenshot.trajectoryId != null ? Number(screenshot.trajectoryId) : null;

  const db = getDB();
  // Step may have been coalesced away between persist and screenshot flush.
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
      (image_data, file_size, mime_type, trajectory_id, trajectory_step_id, kind)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      image_data = VALUES(image_data),
      file_size = VALUES(file_size),
      mime_type = VALUES(mime_type),
      trajectory_id = VALUES(trajectory_id)`,
    [imageData, fileSize, mimeType, trajectoryId, stepId, kind],
  );

  const row = await db(TABLE)
    .select('id')
    .where({ trajectory_step_id: stepId, kind })
    .first();
  return row?.id != null ? Number(row.id) : null;
}

/**
 * UPSERT one phase_highlight screenshot row by (trajectory_phase_id, kind).
 * @returns {Promise<number|null>} row id, or null if phase no longer exists
 */
export async function replaceForPhase(screenshot) {
  const phaseId = screenshot.trajectoryPhaseId != null ? Number(screenshot.trajectoryPhaseId) : null;
  const kind = 'phase_highlight';
  if (!Number.isFinite(phaseId) || phaseId <= 0) {
    throw new Error('trajectoryPhaseId required for replaceForPhase');
  }
  const imageData = screenshot.imageData;
  const fileSize = screenshot.fileSize || (imageData ? imageData.length : 0);
  const mimeType = screenshot.mimeType || 'image/png';
  const trajectoryId = screenshot.trajectoryId != null ? Number(screenshot.trajectoryId) : null;

  const db = getDB();
  const phaseExists = await db('trajectory_phase').where({ id: phaseId }).first('id');
  if (!phaseExists) {
    const err = new Error(`trajectory_phase ${phaseId} not found`);
    err.code = 'ER_NO_REFERENCED_ROW_2';
    throw err;
  }

  await db.raw(
    `INSERT INTO \`${TABLE}\`
      (image_data, file_size, mime_type, trajectory_id, trajectory_step_id, trajectory_phase_id, kind)
     VALUES (?, ?, ?, ?, NULL, ?, ?)
     ON DUPLICATE KEY UPDATE
      image_data = VALUES(image_data),
      file_size = VALUES(file_size),
      mime_type = VALUES(mime_type),
      trajectory_id = VALUES(trajectory_id)`,
    [imageData, fileSize, mimeType, trajectoryId, phaseId, kind],
  );

  const row = await db(TABLE)
    .select('id')
    .where({ trajectory_phase_id: phaseId, kind })
    .first();
  return row?.id != null ? Number(row.id) : null;
}

export async function getImage(id) {
  const row = await getDB()(TABLE)
    .select('id', 'image_data', 'mime_type', 'file_size')
    .where({ id })
    .first();
  return row || null;
}

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

export async function removeByTrajectoryStepId(stepId) {
  const id = Number(stepId);
  if (!Number.isFinite(id) || id <= 0) return 0;
  return getDB()(TABLE).where({ trajectory_step_id: id }).del();
}

export async function remove(id) {
  return getDB()(TABLE).where({ id }).del();
}
