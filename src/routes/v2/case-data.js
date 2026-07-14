import * as caseDataDao from '../../dao/case-data-dao.js';

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

  app.get('/api/v2/case-data/:recordId', async (req, res) => {
    try {
      const record = await caseDataDao.getByRecordId(req.params.recordId);
      if (!record) return res.status(404).json({ error: 'Case data not found' });
      res.json(record);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/v2/case-data/:id', async (req, res) => {
    try {
      await caseDataDao.remove(+req.params.id);
      res.json({ status: 'deleted' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
