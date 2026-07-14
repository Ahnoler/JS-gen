import * as caseDataDao from '../dao/case-data-dao.js';
import * as formSnapshotDao from '../dao/form-snapshot-dao.js';

/**
 * Normalize a Python FormSnapshot dict (snake_case or camelCase) for DAO insert.
 */
function normalizeSnapshot(snap, caseDataId, trajectoryId) {
  return {
    container: snap.container || 'main',
    fieldCount: snap.fieldCount ?? snap.count ?? snap.field_count ?? 0,
    requiredCount: snap.requiredCount ?? snap.required_count ?? 0,
    optionalCount: snap.optionalCount ?? snap.optional_count ?? 0,
    actionIndex: snap.actionIndex ?? snap.action_index ?? 0,
    caseDataId: caseDataId ?? null,
    trajectoryId: trajectoryId ?? null,
    fields: (snap.fields || []).map((f) => ({
      label: f.label,
      isRequired: f.isRequired ?? f.is_required ?? false,
    })),
  };
}

/**
 * Save case_data_store (flat KV + nested form_snapshots/task_list) to the database.
 */
export async function saveCaseData({ recordId, sessionId, model, description, dataStore, trajectoryId }) {
  const entries = [];
  const skipKeys = new Set([
    'form_snapshot', 'form_snapshots', 'task_list',
    '_watcher_mode', '_intervention_queue',
  ]);
  for (const [key, val] of Object.entries(dataStore || {})) {
    if (!skipKeys.has(key) && (val === null || typeof val !== 'object')) {
      entries.push({ fieldKey: key, fieldValue: val == null ? null : String(val) });
    }
  }

  const caseDataId = await caseDataDao.save({
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
    await formSnapshotDao.save(normalizeSnapshot(snap, caseDataId, trajectoryId));
  }

  return caseDataId;
}

/**
 * Persist after JSON store save — accepts already-parsed data dict.
 */
export async function persistSessionCaseData({ record, data }) {
  return saveCaseData({
    recordId: record.recordId,
    sessionId: record.sessionId,
    model: record.model,
    description: record.description,
    dataStore: data,
  });
}
