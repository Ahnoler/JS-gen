import crypto from 'crypto';
import { state } from '../state.js';
import { PROJECT_DIR } from '../config.js';

function parseModel(modelId) {
  if (!modelId) return null;
  const parts = modelId.split('/');
  return parts.length >= 2
    ? { providerID: parts[0], modelID: parts.slice(1).join('/') }
    : { providerID: parts[0], modelID: parts[0] };
}

function messagesToPrompt(messages) {
  return messages.map(m => {
    let content = m.content;
    if (typeof content === 'object') {
      if (Array.isArray(content)) {
        content = content.map(c => {
          if (c.type === 'text') return c.text;
          if (c.type === 'image_url') return '[Image]';
          return '';
        }).filter(Boolean).join('\n');
      } else {
        content = JSON.stringify(content);
      }
    }
    const label = m.role === 'system' ? 'System' : m.role === 'assistant' ? 'Assistant' : 'User';
    return `<|${label}|>\n${content}`;
  }).join('\n\n');
}

function injectToolsToPrompt(promptText, tools, tool_choice) {
  if (!tools || !tools.length) return promptText;

  let toolBlock = '\n\n---\n';
  toolBlock += 'Respond with a JSON object matching one of the following function schemas.\n';
  toolBlock += 'ONLY output the JSON inside a ```json code block, nothing else.\n\n';

  for (const tool of tools) {
    if (tool.type === 'function' && tool.function) {
      toolBlock += `### Function: ${tool.function.name}\n`;
      if (tool.function.description) {
        toolBlock += `${tool.function.description}\n`;
      }
      toolBlock += 'Schema:\n```json\n';
      toolBlock += JSON.stringify(tool.function.parameters, null, 2);
      toolBlock += '\n```\n\n';
    }
  }

  if (tool_choice === 'required') {
    toolBlock += 'You MUST output a valid function call JSON. Do NOT output plain text.\n';
  } else if (tool_choice && typeof tool_choice === 'object' && tool_choice.function) {
    toolBlock += `You MUST call the function "${tool_choice.function.name}" and ONLY output its JSON arguments.\n`;
  }

  return promptText + toolBlock;
}

function extractTokenUsage(parts) {
  const finish = parts?.find(p => p.type === 'step-finish');
  if (finish?.tokens) {
    return {
      prompt_tokens: finish.tokens.input || 0,
      completion_tokens: finish.tokens.output || 0,
      total_tokens: finish.tokens.total || (finish.tokens.input + finish.tokens.output) || 0,
    };
  }
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

function extractTextFromParts(parts) {
  if (!parts) return '';
  const textParts = parts.filter(p => p.type === 'text');
  return textParts.map(p => p.text).join('\n');
}

function tryParseJson(text) {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try { return JSON.parse(match[1].trim()); } catch {}
  }
  try { return JSON.parse(text.trim()); } catch {}
  return null;
}

export default function (app) {

  app.get('/v1/models', (req, res) => {
    const list = state.cachedModels.length > 0 ? state.cachedModels : [];
    res.json({
      object: 'list',
      data: list.map(m => ({
        id: m.id,
        object: 'model',
        created: 0,
        owned_by: m.provider || 'opencode',
      })),
    });
  });

  app.post('/v1/chat/completions', async (req, res) => {
    const { model: modelId, messages, temperature, tools, tool_choice, stream } = req.body || {};

    if (!modelId) return res.status(400).json({ error: { message: 'model is required', type: 'invalid_request_error' } });
    if (!messages || !Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: { message: 'messages is required', type: 'invalid_request_error' } });
    }
    if (!state.client) return res.status(503).json({ error: { message: 'opencode server not ready', type: 'server_error' } });
    if (stream) return res.status(400).json({ error: { message: 'streaming not supported', type: 'invalid_request_error' } });

    const modelObj = parseModel(modelId);
    if (!modelObj) return res.status(400).json({ error: { message: `invalid model: ${modelId}`, type: 'invalid_request_error' } });

    const hasTools = tools && Array.isArray(tools) && tools.length > 0;

    let promptText = messagesToPrompt(messages);
    promptText = injectToolsToPrompt(promptText, tools, tool_choice);

    let sessionId = null;
    try {
      // Create session
      const { data: session, error: createErr } = await state.client.session.create({
        directory: PROJECT_DIR,
        title: `LLM: ${modelId}`,
        agent: 'build',
      });
      if (createErr) {
        return res.status(500).json({
          error: { message: createErr?.message || 'failed to create session', type: 'server_error' },
        });
      }
      sessionId = session.id;

      // Send prompt
      const { data: result, error: promptErr } = await state.client.session.prompt({
        sessionID: session.id,
        directory: PROJECT_DIR,
        agent: 'build',
        model: modelObj,
        parts: [{ type: 'text', text: promptText }],
      });

      if (promptErr) {
        return res.status(500).json({
          error: { message: promptErr?.message || JSON.stringify(promptErr), type: 'server_error' },
        });
      }

      const allParts = result?.parts || [];
      const responseText = extractTextFromParts(allParts);
      const usage = extractTokenUsage(allParts);
      const completionId = 'chatcmpl-' + crypto.randomBytes(12).toString('hex');
      const now = Math.floor(Date.now() / 1000);

      // If tools were requested, try to extract JSON for tool_call response
      if (hasTools && responseText) {
        const parsed = tryParseJson(responseText);
        if (parsed) {
          const functionName = (tool_choice?.function?.name) || tools[0]?.function?.name || 'AgentOutput';
          return res.json({
            id: completionId,
            object: 'chat.completion',
            created: now,
            model: modelId,
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [{
                  id: 'call_' + crypto.randomBytes(8).toString('hex'),
                  type: 'function',
                  function: {
                    name: functionName,
                    arguments: JSON.stringify(parsed),
                  },
                }],
              },
              finish_reason: 'stop',
            }],
            usage,
          });
        }
      }

      // Plain text response
      return res.json({
        id: completionId,
        object: 'chat.completion',
        created: now,
        model: modelId,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: responseText },
          finish_reason: 'stop',
        }],
        usage,
      });

    } catch (err) {
      return res.status(500).json({
        error: { message: err.message, type: 'server_error' },
      });
    } finally {
      if (sessionId) {
        state.client.session.delete({ sessionID: sessionId, directory: PROJECT_DIR }).catch(() => {});
      }
    }
  });
}
