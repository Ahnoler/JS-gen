import { LLM_BASE_URL, LLM_API_KEY } from '../config/config.js';

const DEFAULT_MODEL = 'Qwen/Qwen3.5-35B-A3B';

function resolveModelId(model) {
  if (!model) return DEFAULT_MODEL;
  if (typeof model === 'object' && model.modelID) return model.modelID;
  if (typeof model === 'string') return model;
  return DEFAULT_MODEL;
}

export async function callLLM(text, model) {
  if (!LLM_BASE_URL || !LLM_API_KEY) {
    throw new Error('LLM_BASE_URL and LLM_API_KEY env vars are required in standalone mode');
  }

  const modelId = resolveModelId(model);

  const resp = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_API_KEY}`,
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
