import path from 'path';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import * as caseDataDao from '../../dao/case-data-dao.js';
import { CASE_DATA_DIR } from '../../../config/config.js';

function materializeCaseDataFile(record) {
  if (!existsSync(CASE_DATA_DIR)) mkdirSync(CASE_DATA_DIR, { recursive: true });
  const fileName = `${record.recordId}.json`;
  const filePath = path.resolve(CASE_DATA_DIR, fileName);

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

export default function (app) {
  app.get('/api/v2/case-data', async (req, res) => {
    try {
      const { page, pageSize } = req.query;
      const result = await caseDataDao.list({ page: +page || 1, pageSize: +pageSize || 20 });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/v2/case-data/:recordId/file', async (req, res) => {
    try {
      const record = await caseDataDao.getByRecordId(req.params.recordId);
      if (!record) return res.status(404).json({ error: 'Case data not found' });
      const filePath = materializeCaseDataFile(record);
      res.json({ filePath, recordId: record.recordId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/v2/case-data/:recordId', async (req, res) => {
    try {
      const record = await caseDataDao.getByRecordId(req.params.recordId);
      if (!record) return res.status(404).json({ error: 'Case data not found' });
      res.json(record);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/v2/case-data/:recordId', async (req, res) => {
    try {
      const record = await caseDataDao.getByRecordId(req.params.recordId);
      if (!record) return res.status(404).json({ error: 'Case data not found' });
      await caseDataDao.remove(record.id);
      res.json({ status: 'deleted', recordId: record.recordId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
