import { PROJECT_DIR } from '../config.js';
import { state } from '../state.js';

function parseModel(model) {
  return typeof model === 'string'
    ? { providerID: model.split('/')[0], modelID: model.split('/')[1] || model }
    : model;
}

function applyModel(promptParams, model) {
  if (model) {
    promptParams.model = parseModel(model);
  } else if (state.defaultModel) {
    promptParams.model = state.defaultModel;
  }
}

export default function (app) {
  app.post('/api/agent/execute', async (req, res) => {
    const { agent, task, system, model, skill, sessionId: reqSessionId } = req.body;

    if (!agent) return res.status(400).json({ error: 'agent is required' });
    if (!task) return res.status(400).json({ error: 'task is required' });
    if (!state.client) return res.status(503).json({ error: 'opencode server not ready' });

    let sessionId = reqSessionId || null;
    let sessionWarn = null;

    try {
      let resolvedSystem = system;
      if (skill) {
        const { data: skills } = await state.client.app.skills();
        const found = skills?.find(s => s.name === skill);
        if (found) {
          resolvedSystem = resolvedSystem
            ? `[Skill: ${found.name}]\n${found.description}\n\n${found.content}\n\n${resolvedSystem}`
            : `[Skill: ${found.name}]\n${found.description}\n\n${found.content}`;
        }
      }

      let result;
      let promptErr;

      for (let attempt = 0; attempt < 2; attempt++) {
        if (!sessionId) {
          const { data: session, error: createErr } = await state.client.session.create({
            directory: PROJECT_DIR,
            title: skill ? `API [${skill}]: ${task.slice(0, 60)}` : `API: ${task.slice(0, 80)}`,
            agent,
          });
          if (createErr) return res.status(500).json({ error: createErr?.message || JSON.stringify(createErr) });
          sessionId = session.id;
        }

        const promptParams = {
          sessionID: sessionId,
          directory: PROJECT_DIR,
          agent,
          parts: [{ type: 'text', text: task }],
        };
        if (resolvedSystem) promptParams.system = resolvedSystem;
        applyModel(promptParams, model);

        const resp = await state.client.session.prompt(promptParams);
        result = resp.data;
        promptErr = resp.error;

        if (promptErr) {
          console.log(`[execute] attempt ${attempt + 1}: session ${sessionId} failed: ${promptErr?.message || JSON.stringify(promptErr)}`);
          if (reqSessionId) {
            sessionWarn = `Session ${sessionId} expired, created new one`;
            sessionId = null;
            continue;
          }
        }
        break;
      }

      if (promptErr) return res.status(500).json({ error: promptErr?.message || JSON.stringify(promptErr) });

      const textParts = result.parts.filter(p => p.type === 'text').map(p => p.text);

      const resp = {
        sessionId,
        response: textParts.join('\n'),
        partCount: result.parts.length,
      };
      if (sessionWarn) resp.warning = sessionWarn;
      res.json(resp);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/agent/execute-async', async (req, res) => {
    const { agent, task, system, model, sessionId: reqSessionId } = req.body;

    if (!agent) return res.status(400).json({ error: 'agent is required' });
    if (!task) return res.status(400).json({ error: 'task is required' });
    if (!state.client) return res.status(503).json({ error: 'opencode server not ready' });

    let sessionId = reqSessionId || null;
    let sessionWarn = null;

    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!sessionId) {
          const { data: session, error: createErr } = await state.client.session.create({
            directory: PROJECT_DIR,
            title: `API Async: ${task.slice(0, 80)}`,
            agent,
          });
          if (createErr) return res.status(500).json({ error: createErr?.message || JSON.stringify(createErr) });
          sessionId = session.id;
        }

        const promptParams = {
          sessionID: sessionId,
          directory: PROJECT_DIR,
          agent,
          noReply: true,
          parts: [{ type: 'text', text: task }],
        };
        if (system) promptParams.system = system;

        const resp = await state.client.session.promptAsync(promptParams);
        if (!resp.error) break;

        if (sessionId && reqSessionId) {
          sessionWarn = `Session ${sessionId} expired, created new one`;
          sessionId = null;
          continue;
        }
      }

      const resp = { sessionId, status: 'accepted' };
      if (sessionWarn) resp.warning = sessionWarn;
      res.json(resp);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/agent/session', async (req, res) => {
    const { title, agent } = req.body;
    if (!state.client) return res.status(503).json({ error: 'opencode server not ready' });

    try {
      const { data: session, error } = await state.client.session.create({
        directory: PROJECT_DIR,
        title: title || 'API Session',
        agent,
      });
      if (error) return res.status(500).json({ error: error?.message || JSON.stringify(error) });
      res.json({ sessionId: session.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/agent/session/:id/message', async (req, res) => {
    const { id } = req.params;
    const { agent, task, system } = req.body;
    if (!state.client) return res.status(503).json({ error: 'opencode server not ready' });
    if (!task) return res.status(400).json({ error: 'task is required' });

    try {
      const promptParams = {
        sessionID: id,
        directory: PROJECT_DIR,
        agent: agent || 'build',
        parts: [{ type: 'text', text: task }],
      };
      if (system) promptParams.system = system;
      if (state.defaultModel) promptParams.model = state.defaultModel;

      const { data: result, error } = await state.client.session.prompt(promptParams);
      if (error) return res.status(500).json({ error: error?.message || JSON.stringify(error) });

      const textParts = result.parts.filter(p => p.type === 'text').map(p => p.text);
      res.json({ sessionId: id, response: textParts.join('\n') });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/agent/session/:id', async (req, res) => {
    const { id } = req.params;
    if (!state.client) return res.status(503).json({ error: 'opencode server not ready' });

    try {
      await state.client.session.delete({ sessionID: id, directory: PROJECT_DIR });
      res.json({ status: 'deleted', sessionId: id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/agent/session/:id/messages', async (req, res) => {
    const { id } = req.params;
    if (!state.client) return res.status(503).json({ error: 'opencode server not ready' });

    try {
      const { data, error } = await state.client.session.messages({
        sessionID: id,
        directory: PROJECT_DIR,
      });
      if (error) return res.status(500).json({ error: error?.message || JSON.stringify(error) });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
