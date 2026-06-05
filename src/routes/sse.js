import { PROJECT_DIR } from '../config.js';
import { state } from '../state.js';

export default function (app) {
  app.get('/api/agent/execute-stream', async (req, res) => {
    const agent = req.query.agent || 'general';
    const task = req.query.task;
    const system = req.query.system;
    const skillName = req.query.skill;
    const modelStr = req.query.model;
    const reqSessionId = req.query.sessionId;

    if (!task) return res.status(400).json({ error: 'task query param is required' });
    if (!state.client) return res.status(503).json({ error: 'opencode server not ready' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const heartbeat = setInterval(() => send('heartbeat', { time: Date.now() }), 5000);
    let aborted = false;
    res.on('close', () => {
      aborted = true;
      clearInterval(heartbeat);
    });

    let sessionId = reqSessionId || null;

    try {
      if (sessionId) {
        send('step', { id: 'check-session', status: 'running', label: 'Verifying session' });
        const { error: getErr } = await state.client.session.get({ sessionID: sessionId, directory: PROJECT_DIR }).catch(() => ({ error: true }));
        if (getErr) {
          send('log', { type: 'warn', message: `Session ${sessionId} expired, creating new one` });
          sessionId = null;
        } else {
          send('step', { id: 'check-session', status: 'success', label: 'Session reused' });
          send('log', { type: 'success', message: `Reusing session: ${sessionId}` });
        }
      }

      if (!sessionId) {
        send('step', { id: 'create-session', status: 'running', label: 'Creating session' });
        send('log', { type: 'step', message: 'Connecting to opencode server...' });

        const { data: session, error: createErr } = await state.client.session.create({
          directory: PROJECT_DIR,
          title: skillName ? `SSE [${skillName}]: ${task.slice(0, 60)}` : `SSE: ${task.slice(0, 80)}`,
          agent,
        });

        if (createErr) throw new Error(createErr?.message || JSON.stringify(createErr));

        sessionId = session.id;

        send('step', { id: 'create-session', status: 'success', label: 'Session created' });
        send('log', { type: 'success', message: `Session created: ${session.id}` });
      }

      let resolvedSystem = system;
      if (skillName) {
        const { data: skills, error: skillsErr } = await state.client.app.skills();
        if (skillsErr) {
          send('log', { type: 'warn', message: `Failed to fetch skill "${skillName}": ${skillsErr}` });
        } else {
          const skill = skills.find(s => s.name === skillName);
          if (skill) {
            send('log', { type: 'success', message: `Loaded skill: ${skill.name} — ${skill.description}` });
            resolvedSystem = resolvedSystem
              ? `[Skill: ${skill.name}]\n${skill.description}\n\n${skill.content}\n\n${resolvedSystem}`
              : `[Skill: ${skill.name}]\n${skill.description}\n\n${skill.content}`;
          } else {
            send('log', { type: 'warn', message: `Skill "${skillName}" not found` });
          }
        }
      }

      send('step', { id: 'send-prompt', status: 'running', label: 'Sending task to agent' });
      send('log', { type: 'info', message: `Agent: ${agent}` });
      if (skillName) send('log', { type: 'info', message: `Skill: ${skillName}` });
      send('log', { type: 'info', message: `Task: ${task}` });

      const promptParams = { sessionID: sessionId, directory: PROJECT_DIR, agent, parts: [{ type: 'text', text: task }] };
      if (resolvedSystem) promptParams.system = resolvedSystem;
      if (modelStr) {
        const parts = modelStr.split('/');
        promptParams.model = { providerID: parts[0], modelID: parts.slice(1).join('/') || parts[0] };
      } else if (state.defaultModel) {
        promptParams.model = state.defaultModel;
      }

      send('step', { id: 'send-prompt', status: 'success', label: 'Task sent' });

      send('step', { id: 'agent-processing', status: 'running', label: 'Agent processing...' });
      send('log', { type: 'step', message: 'Waiting for agent response...' });

      const { data: result, error: promptErr } = await state.client.session.prompt(promptParams);

      if (aborted) return;
      if (promptErr) throw new Error(promptErr?.message || JSON.stringify(promptErr));

      send('step', { id: 'agent-processing', status: 'success', label: 'Agent responded' });
      send('log', { type: 'success', message: `Received ${result.parts.length} parts` });

      for (const part of result.parts) {
        if (aborted) return;
        if (part.type === 'text' && part.text) {
          send('text', { text: part.text });
          send('log', { type: 'info', message: part.text.slice(0, 200) });
        } else if (part.type === 'tool-use' || part.type === 'tool_result') {
          send('log', { type: 'warn', message: `[${part.type}] ${JSON.stringify(part).slice(0, 300)}` });
        }
      }

      send('step', { id: 'done', status: 'success', label: 'Task completed' });
      send('log', { type: 'success', message: 'Task completed successfully' });
      send('result', {
        sessionId,
        response: result.parts.filter(p => p.type === 'text').map(p => p.text).join('\n'),
        partCount: result.parts.length,
      });
      send('done', {});

    } catch (err) {
      if (aborted) return;
      send('step', { id: 'error', status: 'failed', label: 'Error' });
      send('log', { type: 'error', message: err.message });
      send('result', { error: err.message });
      send('done', { error: err.message });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  });
}
