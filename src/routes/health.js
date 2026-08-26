import { SKILL_DIR, TMP_DIR } from '../../config/config.js';
import { state } from '../state.js';

/**
 * Health-check and model-discovery endpoints for liveness probes and client
 * startup checks.
 *
 * Prefix: /api/health, /api/models
 * @param {import('express').Application} app Express application
 */
export default function (app) {
  /** Liveness probe: returns status, default model, skill/tmp dirs. */
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      defaultModel: state.defaultModel ? `${state.defaultModel.providerID}/${state.defaultModel.modelID}` : null,
      skillDir: SKILL_DIR,
      tmpDir: TMP_DIR,
    });
  });

  /** List configured models (currently empty array) plus the default model id. */
  app.get('/api/models', (req, res) => {
    res.json({
      models: [],
      defaultModel: state.defaultModel ? `${state.defaultModel.providerID}/${state.defaultModel.modelID}` : null,
    });
  });
}
