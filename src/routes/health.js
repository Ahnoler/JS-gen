import { SKILL_DIR, TMP_DIR } from '../config.js';
import { state } from '../state.js';

export default function (app) {
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      opencode: state.ocServer ? 'connected' : 'starting',
      agents: state.cachedAgents.map(a => ({ name: a.name, description: a.description })),
      skills: state.cachedSkills.map(s => ({ name: s.name, description: s.description })),
      models: state.cachedModels,
      defaultModel: state.defaultModel ? `${state.defaultModel.providerID}/${state.defaultModel.modelID}` : null,
      skillDir: SKILL_DIR,
      tmpDir: TMP_DIR,
    });
  });

  app.get('/api/models', (req, res) => {
    res.json({
      models: state.cachedModels,
      defaultModel: state.defaultModel ? `${state.defaultModel.providerID}/${state.defaultModel.modelID}` : null,
    });
  });

  app.get('/api/agents', (req, res) => {
    res.json({ agents: state.cachedAgents });
  });

  app.get('/api/skills', (req, res) => {
    res.json({ skills: state.cachedSkills });
  });
}
