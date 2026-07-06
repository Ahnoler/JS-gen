import { SKILL_DIR, TMP_DIR } from '../config.js';
import { state } from '../state.js';

export default function (app) {
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      defaultModel: state.defaultModel ? `${state.defaultModel.providerID}/${state.defaultModel.modelID}` : null,
      skillDir: SKILL_DIR,
      tmpDir: TMP_DIR,
    });
  });

  app.get('/api/models', (req, res) => {
    res.json({
      models: [],
      defaultModel: state.defaultModel ? `${state.defaultModel.providerID}/${state.defaultModel.modelID}` : null,
    });
  });

  app.get('/api/agents', (req, res) => {
    res.json({ agents: [] });
  });

  app.get('/api/skills', (req, res) => {
    res.json({ skills: [] });
  });
}
