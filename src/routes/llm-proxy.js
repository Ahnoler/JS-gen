import crypto from 'crypto';
import { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_TIMEOUT_MS } from '#config/config.js';

export default function (app) {

  // Product-facing: list models available on the configured gateway.
  // Use this to discover usable model ids when a configured model 404s
  // (gateway requires full prefixed names, e.g. "Qwen/Qwen3.5-35B-A3B").
  app.get('/api/v2/llm/models', async (req, res) => {
    if (!LLM_BASE_URL || !LLM_API_KEY) {
      return res.status(500).json({ ok: false, error: 'LLM_BASE_URL and LLM_API_KEY env vars are required' });
    }
    try {
      const resp = await fetch(`${LLM_BASE_URL}/models`, {
        headers: { 'Authorization': `Bearer ${LLM_API_KEY}` },
      });
      const text = await resp.text();
      if (!resp.ok) {
        return res.status(502).json({ ok: false, baseUrl: LLM_BASE_URL, error: text || resp.statusText });
      }
      let ids = [];
      try {
        const data = JSON.parse(text);
        ids = (data.data || []).map((m) => m.id).filter(Boolean).sort();
      } catch {
        return res.status(502).json({ ok: false, baseUrl: LLM_BASE_URL, error: 'gateway returned non-JSON model list' });
      }
      return res.json({ ok: true, baseUrl: LLM_BASE_URL, defaultModel: LLM_MODEL, models: ids });
    } catch (err) {
      return res.status(502).json({ ok: false, baseUrl: LLM_BASE_URL, error: err.message });
    }
  });

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
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
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
      // 上游挂起（通道宕机时不返回错误体，只能靠超时切断）→ 504 让调用方快速失败
      const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
      return res.status(timedOut ? 504 : 500).json({
        error: {
          message: timedOut
            ? `upstream timeout after ${LLM_TIMEOUT_MS}ms (model=${modelId}) — LLM 通道疑似挂起，可 GET /api/v2/llm/models 排查`
            : err.message,
          type: timedOut ? 'upstream_timeout' : 'server_error',
        },
      });
    }
  });
}
