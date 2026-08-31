import path from 'path';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import * as businessDataDao from '../../dao/business-data-dao.js';
import { asyncHandler } from '../../http/app-error.js';
import { BUSINESS_DATA_DIR } from '#config/config.js';

function materializeBusinessDataFile(record) {
  if (!existsSync(BUSINESS_DATA_DIR)) mkdirSync(BUSINESS_DATA_DIR, { recursive: true });
  const fileName = `${record.recordId}.json`;
  const filePath = path.resolve(BUSINESS_DATA_DIR, fileName);

  let payload = record.rawJson;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = null; }
  }
  if (!payload || typeof payload !== 'object') {
    payload = {};
    for (const e of record.entries || []) {
      const key = e.fieldKey || e.field_key;
      if (key) payload[key] = e.fieldValue ?? e.field_value ?? null;
    }
  }
  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  return filePath;
}

/**
 * Legacy business_data catalog CRUD + file materialization.
 *
 * Prefix: /api/v2/business-data/*
 * @param {import('express').Application} app Express application
 */
export default function (app) {
  /** List business data records (paginated). */
  app.get('/api/v2/business-data', asyncHandler(async (req, res) => {
    const { page, pageSize } = req.query;
    const result = await businessDataDao.list({ page: +page || 1, pageSize: +pageSize || 20 });
    res.json(result);
  }));

  /** Materialize a business data record's JSON file and return its path. */
  app.get('/api/v2/business-data/:recordId/file', asyncHandler(async (req, res) => {
    const record = await businessDataDao.getByRecordId(req.params.recordId);
    if (!record) return res.status(404).json({ error: 'Business data not found' });
    const filePath = materializeBusinessDataFile(record);
    res.json({ filePath, recordId: record.recordId });
  }));

  /** Get a single business data record by recordId. */
  app.get('/api/v2/business-data/:recordId', asyncHandler(async (req, res) => {
    const record = await businessDataDao.getByRecordId(req.params.recordId);
    if (!record) return res.status(404).json({ error: 'Business data not found' });
    res.json(record);
  }));

  /** Delete a business data record by recordId. */
  app.delete('/api/v2/business-data/:recordId', asyncHandler(async (req, res) => {
    const record = await businessDataDao.getByRecordId(req.params.recordId);
    if (!record) return res.status(404).json({ error: 'Business data not found' });
    await businessDataDao.remove(record.id);
    res.json({ status: 'deleted', recordId: record.recordId });
  }));
}
