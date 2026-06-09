import { LLM_BASE_URL, LLM_API_KEY } from './config.js';

function resolveModelId(model) {
  if (!model) return 'deepseek-v4-flash';
  if (typeof model === 'object' && model.modelID) return model.modelID;
  if (typeof model === 'string') {
    const parts = model.split('/');
    return parts.length >= 2 ? parts.slice(1).join('/') : parts[0];
  }
  return 'deepseek-v4-flash';
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
