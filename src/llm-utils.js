/**
 * Standalone LLM client (no OpenCode SDK): chat-completions fetch wrapper.
 */
import { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_TIMEOUT_MS } from '#config/config.js';

const DEFAULT_MODEL = LLM_MODEL;

function resolveModelId(model) {
  if (!model) return DEFAULT_MODEL;
  if (typeof model === 'object' && model.modelID) return model.modelID;
  if (typeof model === 'string') return model;
  return DEFAULT_MODEL;
}

/**
 * Call the LLM chat-completions endpoint and return the assistant message content.
 * @param {string} text user prompt text
 * @param {string|object} [model] model id or model object; falls back to LLM_MODEL
 * @param {object} [opts] optional transport overrides (role LLMs)
 * @param {string} [opts.baseUrl] OpenAI-compatible base URL (default LLM_BASE_URL)
 * @param {string} [opts.apiKey] Bearer token (default LLM_API_KEY)
 * @param {number} [opts.timeoutMs] fetch AbortSignal timeout (default LLM_TIMEOUT_MS)
 * @returns {Promise<string>} assistant message content (empty string if none)
 */
export async function callLLM(text, model, opts = {}) {
  const baseUrl = String(opts?.baseUrl || LLM_BASE_URL || '').replace(/\/$/, '');
  const apiKey = opts?.apiKey || LLM_API_KEY;
  const timeoutMs = Number(opts?.timeoutMs) > 0 ? Number(opts.timeoutMs) : LLM_TIMEOUT_MS;

  if (!baseUrl || !apiKey) {
    throw new Error('LLM_BASE_URL and LLM_API_KEY env vars are required in standalone mode');
  }

  const modelId = resolveModelId(model);

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: text }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`LLM request failed (${resp.status}): ${errText || resp.statusText}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}
