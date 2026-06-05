import { readFileSync, existsSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { createOpencodeServer } from '@opencode-ai/sdk/v2/server';
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import { PROJECT_DIR } from './config.js';
import { state } from './state.js';
import { Agent, setGlobalDispatcher } from 'undici';

setGlobalDispatcher(new Agent({
  connect: { timeout: 0 },
  headersTimeout: 0,
  bodyTimeout: 0,
  keepAliveTimeout: 120000,
  keepAliveMaxTimeout: 600000,
}));

function loadModelsFromConfig(configPath, label) {
  if (!existsSync(configPath)) return;
  try {
    const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
    const providers = cfg.provider || {};
    for (const [providerId, providerCfg] of Object.entries(providers)) {
      const models = providerCfg.models || {};
      for (const [modelId, modelCfg] of Object.entries(models)) {
        if (!state.defaultModel && modelCfg && modelCfg._launch) {
          state.defaultModel = { providerID: providerId, modelID: modelId };
        }
        const id = `${providerId}/${modelId}`;
        if (!state.cachedModels.some(m => m.id === id) && modelCfg) {
          state.cachedModels.push({ id, provider: providerCfg.name || providerId, name: modelCfg.name || modelId });
        }
      }
    }
  } catch (e) {
    console.warn(`[opencode] Failed to parse ${label}:`, e.message);
  }
}

export async function startOpencode() {
  console.log('[opencode] Starting server...');

  // Load project config and merge env API key
  const apiKey = process.env.OPENCODE_API_KEY;
  let serverConfig = {};
  const projectCfgPath = path.resolve(PROJECT_DIR, 'opencode.json');
  if (existsSync(projectCfgPath)) {
    try {
      serverConfig = JSON.parse(readFileSync(projectCfgPath, 'utf-8'));
    } catch (e) {
      console.warn('[opencode] Failed to read project config:', e.message);
    }
  }
  if (apiKey) {
    for (const p of Object.values(serverConfig.provider || {})) {
      if (p.options) p.options.apiKey = apiKey;
    }
    console.log('[opencode] API key applied from OPENCODE_API_KEY env var');
  }

  state.ocServer = await createOpencodeServer({
    hostname: '127.0.0.1',
    port: 0,
    timeout: 15000,
    config: serverConfig,
  });
  console.log(`[opencode] Server listening at ${state.ocServer.url}`);

  state.client = createOpencodeClient({
    baseUrl: state.ocServer.url,
    directory: PROJECT_DIR,
  });

  const [agentsResult, skillsResult, providersResult] = await Promise.all([
    state.client.app.agents().catch(err => ({ error: err })),
    state.client.app.skills().catch(err => ({ error: err })),
    state.client.config.providers().catch(() => ({ data: null })),
  ]);

  if (agentsResult.error) {
    console.warn('[opencode] Failed to list agents:', agentsResult.error);
  } else {
    state.cachedAgents = agentsResult.data;
    console.log('[opencode] Available agents:', state.cachedAgents.map(a => a.name).join(', '));
  }

  if (skillsResult.error) {
    console.warn('[opencode] Failed to list skills:', skillsResult.error);
  } else {
    state.cachedSkills = skillsResult.data;
    console.log('[opencode] Available skills:', state.cachedSkills.map(s => s.name).join(', '));
  }

  // Load models from opencode server providers API
  const providersData = providersResult?.data;
  if (providersData?.providers) {
    for (const p of providersData.providers) {
      for (const [modelId, m] of Object.entries(p.models || {})) {
        const id = `${p.id}/${modelId}`;
        if (!state.cachedModels.some(cm => cm.id === id)) {
          state.cachedModels.push({ id, provider: p.name || p.id, name: m.name || modelId });
        }
      }
    }
    console.log('[opencode] Models from server:', state.cachedModels.map(m => m.id).join(', '));
  }

  // Supplement with project-level opencode.json
  loadModelsFromConfig(path.resolve(PROJECT_DIR, 'opencode.json'), 'project opencode.json');

  // Supplement with global opencode config
  const globalDir = path.resolve(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'opencode');
  for (const name of ['opencode.json', 'opencode.jsonc', 'config.json']) {
    loadModelsFromConfig(path.join(globalDir, name), 'global ' + name);
  }
  if (process.env.APPDATA) {
    const winDir = path.resolve(process.env.APPDATA, 'opencode');
    for (const name of ['opencode.json', 'opencode.jsonc', 'config.json']) {
      const p = path.join(winDir, name);
      if (p.startsWith(globalDir)) continue;
      loadModelsFromConfig(p, 'global ' + name + ' (APPDATA)');
    }
  }

  if (state.cachedModels.length) {
    console.log('[opencode] Available models:', state.cachedModels.map(m => m.id).join(', '));
  } else {
    console.log('[opencode] No models available');
  }
}
