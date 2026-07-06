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
        model: model || (state.defaultModel ? state.defaultModel.modelID : 'deepseek-v4-flash'),
      });
      res.json({ response: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Stubs — no session management in standalone mode
  app.post('/api/agent/execute-async', (req, res) => res.status(501).json({ error: 'Not available in standalone mode' }));
  app.post('/api/agent/session', (req, res) => res.status(501).json({ error: 'Not available in standalone mode' }));
  app.post('/api/agent/session/:id/message', (req, res) => res.status(501).json({ error: 'Not available in standalone mode' }));
  app.delete('/api/agent/session/:id', (req, res) => res.status(501).json({ error: 'Not available in standalone mode' }));
  app.get('/api/agent/session/:id/messages', (req, res) => res.status(501).json({ error: 'Not available in standalone mode' }));
}
