import {
  loadCaseDataIndex,
  getCaseDataRecord,
  loadCaseDataJson,
  deleteCaseData,
} from '../case-data-store.js';
import path from 'path';
import { CASE_DATA_DIR } from '../../../config/config.js';

export default function (app) {
  app.get('/api/case-data', (req, res) => {
    const list = loadCaseDataIndex();
    res.json(list.map(r => ({
      recordId: r.recordId,
      description: r.description,
      sessionId: r.sessionId,
      keyCount: r.keyCount,
      createdAt: r.createdAt,
    })));
  });

  app.get('/api/case-data/:recordId', (req, res) => {
    const record = getCaseDataRecord(req.params.recordId);
    if (!record) return res.status(404).json({ error: 'Case data not found' });

    const includeJson = req.query.full === '1' || req.query.full === 'true';
    const payload = { ...record };

    if (includeJson) {
      const data = loadCaseDataJson(req.params.recordId);
      if (!data) return res.status(404).json({ error: 'Case data file missing' });
      payload.data = data;
    }

    res.json(payload);
  });

  app.get('/api/case-data/:recordId/file', (req, res) => {
    const record = getCaseDataRecord(req.params.recordId);
    if (!record) return res.status(404).json({ error: 'Case data not found' });
    const filePath = path.resolve(CASE_DATA_DIR, record.fileName);
    res.json({ filePath });
  });

  app.delete('/api/case-data/:recordId', (req, res) => {
    const ok = deleteCaseData(req.params.recordId);
    if (!ok) return res.status(404).json({ error: 'Case data not found' });
    res.json({ status: 'deleted', recordId: req.params.recordId });
  });
}
