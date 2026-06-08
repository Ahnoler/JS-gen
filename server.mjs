import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { PORT, HOST, TMP_DIR, DASHBOARD_DIR, STANDALONE_LLM, PROJECT_DIR } from './src/config.js';
import { startOpencode } from './src/opencode.js';
import { state } from './src/state.js';
import registerHealthRoutes from './src/routes/health.js';
import registerAgentRoutes from './src/routes/agent.js';
import registerTestGenRoutes from './src/routes/test-gen.js';
import registerTestHistoryRoutes from './src/routes/test-history.js';
import registerTestRunRoutes from './src/routes/test-run.js';
import registerLLMProxyRoutes from './src/routes/llm-proxy.js';
import registerExploreRoutes from './src/routes/explore-route.js';
import registerBrowserSessionRoutes from './src/routes/browser-session.js';
import registerTrajectoryRoutes from './src/routes/trajectory.js';
import registerCaseDataRoutes from './src/routes/case-data.js';
import registerSSERoutes from './src/routes/sse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/api/test/screenshots', express.static(TMP_DIR));
app.use(express.static(DASHBOARD_DIR, { maxAge: 0 }));

// Register all route modules
registerLLMProxyRoutes(app);
const exploreLockRef = { value: false };
registerExploreRoutes(app, exploreLockRef);
registerBrowserSessionRoutes(app);
registerTrajectoryRoutes(app);
registerCaseDataRoutes(app);
registerHealthRoutes(app);
registerAgentRoutes(app);
registerTestGenRoutes(app);
registerTestHistoryRoutes(app);
registerTestRunRoutes(app);
registerSSERoutes(app);

// Redirect root to test dashboard
app.get('/', (req, res) => res.redirect('/api/test'));

app.get('/api/test', (req, res) => {
  res.sendFile(path.join(__dirname, 'test-dashboard.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: err.message || 'Internal server error' });
});

function loadDefaultModel() {
  const apiCfgPath = path.join(PROJECT_DIR, 'agent-api.config.json');
  if (existsSync(apiCfgPath)) {
    try {
      const cfg = JSON.parse(readFileSync(apiCfgPath, 'utf-8'));
      const defaultModelStr = cfg.defaultModel;
      if (defaultModelStr) {
        const parts = defaultModelStr.split('/');
        if (parts.length >= 2) {
          state.defaultModel = { providerID: parts[0], modelID: parts.slice(1).join('/') };
        }
      }
    } catch (e) {
      console.warn('[server] Failed to parse agent-api.config.json:', e.message);
    }
  }
  if (!state.defaultModel) {
    const ocCfgPath = path.join(PROJECT_DIR, 'opencode.json');
    if (existsSync(ocCfgPath)) {
      try {
        const cfg = JSON.parse(readFileSync(ocCfgPath, 'utf-8'));
        const providers = cfg.provider || {};
        for (const [providerId, providerCfg] of Object.entries(providers)) {
          const models = providerCfg.models || {};
          for (const [modelId, modelCfg] of Object.entries(models)) {
            if (!state.defaultModel && modelCfg && modelCfg._launch) {
              state.defaultModel = { providerID: providerId, modelID: modelId };
            }
          }
        }
      } catch (e) {
        console.warn('[server] Failed to parse opencode.json:', e.message);
      }
    }
  }
}

async function main() {
  loadDefaultModel();
  if (state.defaultModel) {
    console.log(`[server] Default model: ${state.defaultModel.providerID}/${state.defaultModel.modelID}`);
  }
  if (STANDALONE_LLM) {
    console.log('[server] Running in standalone LLM mode (no OpenCode SDK)');
  } else {
    await startOpencode();
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`[server] Agent API listening on http://${HOST}:${PORT}`);
    console.log(`[server] Endpoints:`);
    console.log(`  GET  /v1/models (OpenAI compatible)`);
    console.log(`  POST /v1/chat/completions (OpenAI compatible)`);
    console.log(`  POST /api/browser-use/explore (SSE - Browser Use exploration, saves trajectory)`);
    console.log(`  GET  /api/trajectory`);
    console.log(`  GET  /api/trajectory/:id`);
    console.log(`  DELETE /api/trajectory/:id`);
    console.log(`  GET  /api/health`);
    console.log(`  GET  /api/agents`);
    console.log(`  GET  /api/skills`);
    console.log(`  POST /api/agent/execute`);
    console.log(`  SSE  /api/agent/execute-stream`);
    console.log(`  POST /api/agent/execute-async`);
    console.log(`  POST /api/agent/session`);
    console.log(`  GET  /api/agent/session/:id/messages`);
    console.log(`  POST /api/agent/session/:id/message`);
    console.log(`  DELETE /api/agent/session/:id`);
    console.log(`  POST /api/test/generate (script generation)`);
    console.log(`  POST /api/test/refine (refine script)`);
    console.log(`  GET  /api/test/history`);
    console.log(`  GET  /api/test/history/:id`);
    console.log(`  DELETE /api/test/history/:id`);
    console.log(`  POST /api/test/run (SSE streaming)`);
    console.log(`  POST /api/test/run-sync (JSON)`);
    console.log(`  GET  /api/test/screenshots/* (static)`);
    console.log(`  GET  /api/test (dashboard)`);
  });
  server.timeout = 0;
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 0;
  server.requestTimeout = 0;
}

main().catch(err => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n[server] Shutting down...');
  if (!STANDALONE_LLM && state.ocServer) state.ocServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[server] Shutting down...');
  if (!STANDALONE_LLM && state.ocServer) state.ocServer.close();
  process.exit(0);
});
