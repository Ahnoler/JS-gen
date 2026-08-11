import * as sysDictService from '../../services/sys-dict-service.js';

function statusOf(err) {
  return err?.statusCode || 500;
}

export default function registerSysDict(app) {
  // ── Dict types ──
  app.get('/api/v2/system/dict/type', async (req, res) => {
    try {
      const data = await sysDictService.listTypes({ status: req.query.status });
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.get('/api/v2/system/dict/type/:dictId', async (req, res) => {
    try {
      const data = await sysDictService.getType(req.params.dictId);
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.post('/api/v2/system/dict/type', async (req, res) => {
    try {
      const data = await sysDictService.createType(req.body || {});
      res.status(201).json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.put('/api/v2/system/dict/type/:dictId', async (req, res) => {
    try {
      const data = await sysDictService.updateType(req.params.dictId, req.body || {});
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.delete('/api/v2/system/dict/type/:dictId', async (req, res) => {
    try {
      const data = await sysDictService.deleteType(req.params.dictId);
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  // ── Dict data ──
  // More specific path first
  app.get('/api/v2/system/dict/data/type/:dictType', async (req, res) => {
    try {
      const data = await sysDictService.listDataByType(req.params.dictType);
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.get('/api/v2/system/dict/data', async (req, res) => {
    try {
      const data = await sysDictService.listData(req.query || {});
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.get('/api/v2/system/dict/data/:dictCode', async (req, res) => {
    try {
      const data = await sysDictService.getData(req.params.dictCode);
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.post('/api/v2/system/dict/data', async (req, res) => {
    try {
      const data = await sysDictService.createData(req.body || {});
      res.status(201).json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.put('/api/v2/system/dict/data/:dictCode', async (req, res) => {
    try {
      const data = await sysDictService.updateData(req.params.dictCode, req.body || {});
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.delete('/api/v2/system/dict/data/:dictCode', async (req, res) => {
    try {
      const data = await sysDictService.deleteData(req.params.dictCode);
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });
}
