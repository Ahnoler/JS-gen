import crypto from 'crypto';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { LLM_BASE_URL, PROJECT_DIR } from '../../config/config.js';

function getApiKey() {
  try {
    const envPath = path.join(PROJECT_DIR, 'config', '.env');
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf-8');
      const match = content.match(/^LLM_API_KEY=(.+)$/m);
      if (match && match[1].trim()) return match[1].trim();
    }
  } catch {}
  return process.env.LLM_API_KEY || '';
}

export default function (app) {

  app.get('/v1/models', async (req, res) => {
    const apiKey = getApiKey();
    if (!LLM_BASE_URL || !apiKey) {
      return res.status(500).json({ error: { message: 'LLM_BASE_URL and LLM_API_KEY env vars are required', type: 'server_error' } });
    }
    try {
      const resp = await fetch(`${LLM_BASE_URL}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
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

    const apiKey = getApiKey();
    if (!LLM_BASE_URL || !apiKey) {
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
          'Authorization': `Bearer ${apiKey}`,
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
