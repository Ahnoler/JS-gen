import * as specialElementService from '../../services/special-element-service.js';

function statusOf(err) {
  return err?.statusCode || 500;
}

export default function registerSpecialElement(app) {
  // Static paths before :id
  app.post('/api/v2/special-elements/from-trajectory', async (req, res) => {
    try {
      const data = await specialElementService.createFromTrajectory(req.body || {});
      res.status(201).json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.post('/api/v2/special-elements/search', async (req, res) => {
    try {
      const data = await specialElementService.search(req.body || {});
      res.json({ items: data, total: data.length });
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.get('/api/v2/special-elements', async (req, res) => {
    try {
      const data = await specialElementService.listSpecialElements(req.query || {});
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.get('/api/v2/special-elements/:id', async (req, res) => {
    try {
      const data = await specialElementService.getSpecialElement(req.params.id);
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.put('/api/v2/special-elements/:id', async (req, res) => {
    try {
      const data = await specialElementService.updateSpecialElement(
        req.params.id,
        req.body || {},
      );
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.delete('/api/v2/special-elements/:id', async (req, res) => {
    try {
      const data = await specialElementService.deleteSpecialElement(req.params.id);
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.post('/api/v2/special-elements/:id/replay', async (req, res) => {
    try {
      const body = req.body || {};
      const data = await specialElementService.replaySpecialElement(req.params.id, {
        trajectoryId: body.trajectoryId,
        persist: !!body.persist,
      });
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.patch('/api/v2/special-element-steps/:id', async (req, res) => {
    try {
      const data = await specialElementService.updateStep(req.params.id, req.body || {});
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.delete('/api/v2/special-element-steps/:id', async (req, res) => {
    try {
      const data = await specialElementService.deleteStep(req.params.id);
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });
}
