import { getDB } from '../../config/database.js';
import { fromDbRows } from './helpers.js';

const TABLE = 'screenshot';

export async function save(screenshot) {
  const [id] = await getDB()(TABLE).insert({
    file_name: screenshot.fileName,
    image_data: screenshot.imageData, // Buffer — mysql2 handles BLOB
    file_size: screenshot.fileSize || (screenshot.imageData ? screenshot.imageData.length : 0),
    mime_type: screenshot.mimeType || 'image/png',
    trajectory_id: screenshot.trajectoryId || null,
    step_index: screenshot.stepIndex || 0,
  });
  return id;
}

export async function getImage(id) {
  const row = await getDB()(TABLE)
    .select('id', 'image_data', 'mime_type', 'file_size', 'file_name')
    .where({ id })
    .first();
  return row || null;
}

export async function listByTrajectory(trajectoryId) {
  const rows = await getDB()(TABLE)
    .select('id', 'file_name', 'file_size', 'mime_type', 'step_index', 'created_at')
    .where({ trajectory_id: trajectoryId })
    .orderBy('step_index');
  return fromDbRows(rows);
}

export async function remove(id) {
  return getDB()(TABLE).where({ id }).del();
}
