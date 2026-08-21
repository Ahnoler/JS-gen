import { state } from '../state.js';
import { callLLM } from '../llm-utils.js';

export default function (app) {
  app.post('/api/agent/execute', async (req, res) => {
    const { task, system, model } = req.body;
    if (!task) return res.status(400).json({ error: 'task is required' });
    try {
      const result = await callLLM({
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: task },
        ],
        model: model || (state.defaultModel ? state.defaultModel.modelID : 'Qwen/Qwen3.5-35B-A3B'),
      });
      res.json({ response: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Stubs — no session management in standalone mode
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
