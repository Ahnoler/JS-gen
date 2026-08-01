import { getDB } from '../../config/database.js';
import { fromDbRows } from './helpers.js';

const TABLE = 'screenshot';

const META_COLS = [
  'screenshot.id',
  'screenshot.file_size',
  'screenshot.mime_type',
  'screenshot.trajectory_id',
  'screenshot.trajectory_step_id',
  'screenshot.kind',
  'screenshot.created_at',
];

/**
 * UPSERT one screenshot row by (trajectory_step_id, kind).
 * @returns {Promise<number>} row id
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

/** @deprecated Prefer replaceForStep — kept for callers that still use save(). */
export async function save(screenshot) {
  if (screenshot.trajectoryStepId != null && screenshot.kind) {
    return replaceForStep(screenshot);
  }
  const [id] = await getDB()(TABLE).insert({
    image_data: screenshot.imageData,
    file_size: screenshot.fileSize || (screenshot.imageData ? screenshot.imageData.length : 0),
    mime_type: screenshot.mimeType || 'image/png',
    trajectory_id: screenshot.trajectoryId || null,
    trajectory_step_id: screenshot.trajectoryStepId || null,
    kind: screenshot.kind === 'before' ? 'before' : 'after',
  });
  return id;
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
