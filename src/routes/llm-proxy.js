import crypto from 'crypto';
import { LLM_BASE_URL, LLM_API_KEY } from '../config.js';

export default function (app) {

  app.get('/v1/models', async (req, res) => {
    if (!LLM_BASE_URL || !LLM_API_KEY) {
      return res.status(500).json({ error: { message: 'LLM_BASE_URL and LLM_API_KEY env vars are required', type: 'server_error' } });
    }
    try {
      const resp = await fetch(`${LLM_BASE_URL}/models`, {
        headers: { 'Authorization': `Bearer ${LLM_API_KEY}` },
      });
      if (!resp.ok) return res.status(resp.status).json({ error: { message: resp.statusText } });
      return res.json(await resp.json());
    } catch (err) {
      return res.status(500).json({ error: { message: err.message } });
    }
  });

  app.post('/v1/chat/completions', async (req, res) => {
    const { model: modelId, messages, temperature, tools, tool_choice, stream } = req.body || {};

    if (!modelId) return res.status(400).json({ error: { message: 'model is required', type: 'invalid_request_error' } });
    if (!messages || !Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: { message: 'messages is required', type: 'invalid_request_error' } });
    }
    if (!LLM_BASE_URL || !LLM_API_KEY) {
      return res.status(500).json({ error: { message: 'LLM_BASE_URL and LLM_API_KEY env vars are required', type: 'server_error' } });
    }
    if (stream) return res.status(400).json({ error: { message: 'streaming not supported', type: 'invalid_request_error' } });

    const completionId = 'chatcmpl-' + crypto.randomBytes(12).toString('hex');
    const now = Math.floor(Date.now() / 1000);

    try {
      const resp = await fetch(`${LLM_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LLM_API_KEY}`,
        },
        body: JSON.stringify({ model: modelId, messages, temperature, tools, tool_choice, thinking: { type: 'disabled' } }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return res.status(resp.status).json({ error: { message: errText || resp.statusText, type: 'upstream_error' } });
      }

      const data = await resp.json();
      return res.json({ ...data, id: completionId, created: now });
    } catch (err) {
      return res.status(500).json({ error: { message: err.message, type: 'server_error' } });
    }
  });
}
