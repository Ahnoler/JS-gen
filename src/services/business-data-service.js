/**
 * Business data + form snapshot persistence service.
 */
import * as businessDataDao from '../dao/business-data-dao.js';
import * as formSnapshotDao from '../dao/form-snapshot-dao.js';
import { existsSync, readFileSync } from 'fs';

/**
 * Normalize a Python FormSnapshot dict (snake_case or camelCase) for DAO insert.
 * @param {object} snap raw snapshot dict (snake_case or camelCase keys)
 * @param {number|null} [businessDataId] associated business_data id
 * @param {number|null} [trajectoryId] associated trajectory id
 * @returns {object} normalized snapshot ready for formSnapshotDao.save
 */
function normalizeSnapshot(snap, businessDataId, trajectoryId) {
  return {
    container: snap.container || 'main',
    fieldCount: snap.fieldCount ?? snap.count ?? snap.field_count ?? 0,
    requiredCount: snap.requiredCount ?? snap.required_count ?? 0,
    optionalCount: snap.optionalCount ?? snap.optional_count ?? 0,
    actionIndex: snap.actionIndex ?? snap.action_index ?? 0,
    businessDataId: businessDataId ?? null,
    trajectoryId: trajectoryId ?? null,
    fields: (snap.fields || []).map((f) => ({
      label: f.label,
      isRequired: f.isRequired ?? f.is_required ?? false,
    })),
  };
}

/**
 * Save business_data_store (flat KV + nested form_snapshots/task_list) to the database.
 * @param {object} opts save options
 * @param {string} opts.recordId business_data record id
 * @param {string} opts.sessionId agent session id
 * @param {string} [opts.model] LLM model name
 * @param {string} [opts.description] description
 * @param {object} opts.dataStore raw key/value store
 * @param {number} [opts.trajectoryId] associated trajectory id
 * @returns {Promise<number>} inserted business_data id
 */
export async function saveBusinessData({ recordId, sessionId, model, description, dataStore, trajectoryId }) {
  const entries = [];
  const skipKeys = new Set([
    'form_snapshot', 'form_snapshots', 'task_list',
    '_watcher_mode',
    '_phase_boundary', '_evidence_observed', '_form_stale',
    '_task_lists_by_container', '_active_container', '_parent_container_before_picker',
  ]);
  for (const [key, val] of Object.entries(dataStore || {})) {
    if (!skipKeys.has(key) && (val === null || typeof val !== 'object')) {
      entries.push({ fieldKey: key, fieldValue: val == null ? null : String(val) });
    }
  }

  const businessDataId = await businessDataDao.save({
    recordId,
    sessionId,
    model,
    description,
    keyCount: entries.length,
    rawJson: dataStore,
    entries,
  });

  const snapshots = dataStore?.form_snapshots
    || (dataStore?.form_snapshot ? [dataStore.form_snapshot] : []);
  for (const snap of snapshots) {
    await formSnapshotDao.save(normalizeSnapshot(snap, businessDataId, trajectoryId));
  }

  return businessDataId;
}

/**
 * Persist after JSON store save — accepts already-parsed data dict.
 * @param {object} opts persist options
 * @param {object} opts.record business_data record metadata
 * @param {object} opts.data parsed data store dict
 * @param {number} [opts.trajectoryId] associated trajectory id
 * @returns {Promise<number>} inserted business_data id
 */
export async function persistSessionBusinessData({ record, data, trajectoryId }) {
  return saveBusinessData({
    recordId: record.recordId,
    sessionId: record.sessionId,
    model: record.model,
    description: record.description,
    dataStore: data,
    trajectoryId: trajectoryId ?? null,
  });
}

/**
 * Persist form_{ts}.json snapshots under a trajectory (and optional business_data).
 * @param {string} formFilePath path to form snapshot JSON file
 * @param {object} [opts] snapshot association options
 * @param {number} [opts.trajectoryId] associated trajectory id
 * @param {number} [opts.businessDataId] associated business_data id
 * @returns {Promise<number>} count of snapshots persisted
 */
export async function persistFormSnapshotsFromFile(formFilePath, { trajectoryId, businessDataId } = {}) {
  if (!formFilePath || !existsSync(formFilePath)) return 0;
  let snapshots;
  try {
    snapshots = JSON.parse(readFileSync(formFilePath, 'utf-8'));
  } catch (err) {
    console.warn('[business-data] Failed to read form file:', err.message);
    return 0;
  }
  if (!Array.isArray(snapshots)) {
    snapshots = snapshots ? [snapshots] : [];
  }
  let n = 0;
  for (const snap of snapshots) {
    await formSnapshotDao.save(normalizeSnapshot(snap, businessDataId ?? null, trajectoryId ?? null));
    n += 1;
  }
  return n;
}
