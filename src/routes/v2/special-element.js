import * as specialElementService from '../../services/special-element-service.js';

/**
 * Special element library CRUD + search + replay + step management.
 *
 * Prefix: /api/v2/special-elements/*, /api/v2/special-element-steps/*
 */

function statusOf(err) {
  return err?.statusCode || 500;
}

/**
 * Register special-element routes.
 * @param {import('express').Application} app Express application
 */
export default function registerSpecialElement(app) {
  // Static paths before :id
  /** Create special elements by mining a recorded trajectory. */
  app.post('/api/v2/special-elements/from-trajectory', async (req, res) => {
    try {
      const data = await specialElementService.createFromTrajectory(req.body || {});
      res.status(201).json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  /** Search special elements by criteria. */
  app.post('/api/v2/special-elements/search', async (req, res) => {
    try {
      const data = await specialElementService.search(req.body || {});
      res.json({ items: data, total: data.length });
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  /** List special elements (filtered). */
  app.get('/api/v2/special-elements', async (req, res) => {
    try {
      const data = await specialElementService.listSpecialElements(req.query || {});
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  /** Get a single special element by id. */
  app.get('/api/v2/special-elements/:id', async (req, res) => {
    try {
      const data = await specialElementService.getSpecialElement(req.params.id);
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  /** Update a special element. */
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

  /** Delete a special element. */
  app.delete('/api/v2/special-elements/:id', async (req, res) => {
    try {
      const data = await specialElementService.deleteSpecialElement(req.params.id);
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  /** Replay a special element against a trajectory (optionally persist). */
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

  /** Create a step under a special element. */
  app.post('/api/v2/special-elements/:id/steps', async (req, res) => {
    try {
      const data = await specialElementService.createStep(req.params.id, req.body || {});
      res.status(201).json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });


  /** Update a special-element step (partial). */
  app.patch('/api/v2/special-element-steps/:id', async (req, res) => {
    try {
      const data = await specialElementService.updateStep(req.params.id, req.body || {});
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  /** Delete a special-element step. */
  app.delete('/api/v2/special-element-steps/:id', async (req, res) => {
    try {
      const data = await specialElementService.deleteStep(req.params.id);
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });
}
