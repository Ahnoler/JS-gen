import { state } from '../state.js';
import { callLLM } from '../llm-utils.js';
import { LLM_MODEL } from '#config/config.js';

/**
 * Standalone LLM agent endpoint — single-shot task execution, no session
 * management in standalone mode (async/session routes stubbed to 501).
 *
 * Prefix: /api/agent/*
 * @param {import('express').Application} app Express application
 */
export default function (app) {
  /** Execute a single LLM task: { task, system, model } -> { response }. */
  app.post('/api/agent/execute', async (req, res) => {
    const { task, system, model } = req.body;
    if (!task) return res.status(400).json({ error: 'task is required' });
    try {
      const result = await callLLM({
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: task },
        ],
        model: model || (state.defaultModel ? state.defaultModel.modelID : LLM_MODEL),
      });
      res.json({ response: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Stubs — no session management in standalone mode (each returns 501).
  const STUBS = [
    ['post', '/api/agent/execute-async'],
    ['post', '/api/agent/session'],
    ['post', '/api/agent/session/:id/message'],
    ['delete', '/api/agent/session/:id'],
    ['get', '/api/agent/session/:id/messages'],
  ];
  for (const [method, path] of STUBS) {
    app[method](path, (req, res) => res.status(501).json({ error: 'Not available in standalone mode' }));
  }
}
