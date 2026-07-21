import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { PORT, HOST, TMP_DIR, DASHBOARD_DIR, PROJECT_DIR, LLM_API_KEY, EXECUTOR_HEARTBEAT_TIMEOUT_MS } from './config/config.js';
import { state } from './src/state.js';
import { initWebSocket } from './src/ws-server.js';
import { initExecutorWs, validateExecutorToken, rejectUpgrade } from './src/executor-ws.js';
import * as executorService from './src/services/executor-node-service.js';
import registerHealthRoutes from './src/routes/health.js';
import registerAgentRoutes from './src/routes/agent.js';

import registerTestHistoryRoutes from './src/routes/test-history.js';
import registerTestRunRoutes from './src/routes/test-run.js';
import registerLLMProxyRoutes from './src/routes/llm-proxy.js';
import registerBrowserSessionRoutes from './src/routes/browser-session.js';
import registerAssembleRoutes from './src/routes/test-assemble.js';
import registerLegacyGoneRoutes from './src/routes/legacy-gone.js';
import registerV2Routes from './src/routes/v2/__init__.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/api/test/screenshots', express.static(TMP_DIR));
app.use('/scripts', express.static(path.join(PROJECT_DIR, 'scripts')));
app.use(express.static(DASHBOARD_DIR, { maxAge: 0 }));

// ── First-launch setup (when no API key is configured) ──────────────────
let _currentApiKey = LLM_API_KEY;            // mutable copy — updated on save
const _isConfigured = () => !!(_currentApiKey && _currentApiKey.trim());

// Serve the setup page
app.get('/api/setup', (req, res) => {
  res.sendFile(path.join(PROJECT_DIR, 'config', 'setup.html'));
});

// Save config from setup form
app.post('/api/setup/save', (req, res) => {
  const { LLM_API_KEY: key, LLM_BASE_URL: url, FORM_LLM_MODEL: model } = req.body || {};
  if (!key || !key.trim()) {
    return res.status(400).json({ ok: false, error: 'API Key 不能为空' });
  }
  const envPath = path.join(PROJECT_DIR, 'config', '.env');
  const lines = [];
  lines.push('# ───────────────────────────────────────');
  lines.push('# 智能填表系统 — 运行配置');
  lines.push('# ───────────────────────────────────────');
  lines.push('');
  lines.push('# 服务器');
  lines.push('PORT=4097');
  lines.push('HOST=0.0.0.0');
  lines.push('');
  lines.push('# LLM 连接');
  lines.push(`LLM_BASE_URL=${url || 'https://api.deepseek.com'}`);
  lines.push(`LLM_API_KEY=${key.trim()}`);
  lines.push('');
  lines.push('# 表单填写 LLM（可选用更便宜的模型）');
  lines.push(`FORM_LLM_MODEL=${model || 'deepseek-v4-flash'}`);
  lines.push(`FORM_LLM_BASE_URL=${url || 'https://api.deepseek.com'}`);
  lines.push(`FORM_LLM_API_KEY=${key.trim()}`);
  lines.push('');
  lines.push('# Python 解释器路径（留空则自动查找）');
  lines.push('# PYTHON_EXE=');
  lines.push('');
  lines.push('# 项目根目录（留空则自动检测）');
  lines.push('# PROJECT_DIR=');
  try {
    writeFileSync(envPath, lines.join('\n'), 'utf-8');
    _currentApiKey = key.trim();            // update runtime state
    console.log('[server] API Key saved via setup page');
    res.json({ ok: true });
  } catch (e) {
    console.error('[server] Failed to save .env:', e.message);
    res.status(500).json({ ok: false, error: '写入配置文件失败: ' + e.message });
  }
});

// Register all route modules
registerLLMProxyRoutes(app);
registerBrowserSessionRoutes(app);
// Legacy JSON catalogs: return 410 Gone → use /api/v2/trajectories|case-data
registerLegacyGoneRoutes(app);
registerAssembleRoutes(app);
registerHealthRoutes(app);
registerAgentRoutes(app);

registerTestHistoryRoutes(app);
registerTestRunRoutes(app);
registerV2Routes(app);

// Redirect root to dashboard, or setup if unconfigured
app.get('/', (req, res) => {
  res.redirect(_isConfigured() ? '/api/test' : '/api/setup');
});

// API key status check (used by dashboard to detect unconfigured state)
app.get('/api/setup/status', (req, res) => {
  res.json({ configured: _isConfigured() });
});

app.get('/api/test', (req, res) => {
  if (!_isConfigured()) return res.redirect('/api/setup');
  res.sendFile(path.join(__dirname, 'test-dashboard.html'));
});

/** Product API docs for frontend (Swagger-like, /api/v2 + WebSocket) */
app.get('/api/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'api-docs.html'));
});

/** Backend self-use recording console (not product SPA) */
app.get('/api/test/record-console', (req, res) => {
  if (!_isConfigured()) return res.redirect('/api/setup');
  res.sendFile(path.join(__dirname, 'record-console.html'));
});

/** Dedicated recording studio: left canvas + right phase/steps */
app.get('/api/test/record-studio', (req, res) => {
  if (!_isConfigured()) return res.redirect('/api/setup');
  res.sendFile(path.join(__dirname, 'record-studio.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: err.message || 'Internal server error' });
});

function loadDefaultModel() {
  const apiCfgPath = path.join(PROJECT_DIR, 'config', 'agent-api.json');
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
}

async function main() {
  loadDefaultModel();
  if (state.defaultModel) {
    console.log(`[server] Default model: ${state.defaultModel.providerID}/${state.defaultModel.modelID}`);
  }

  if (!_isConfigured()) {
    console.log('[server] ⚠  LLM_API_KEY not set — visit http://localhost:' + PORT + '/api/setup to configure');
  }

  const httpServer = createServer(app);
  const dashboardWss = initWebSocket();
  const executorWss = initExecutorWs();

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (pathname === '/ws') {
      dashboardWss.handleUpgrade(req, socket, head, (ws) => {
        dashboardWss.emit('connection', ws, req);
      });
      return;
    }

    if (pathname === '/ws/executor') {
      if (!validateExecutorToken(req)) {
        rejectUpgrade(socket, 401, 'Unauthorized');
        return;
      }
      executorWss.handleUpgrade(req, socket, head, (ws) => {
        executorWss.emit('connection', ws, req);
      });
      return;
    }

    socket.destroy();
  });

  const sweepInterval = setInterval(() => {
    executorService.sweepStale(EXECUTOR_HEARTBEAT_TIMEOUT_MS).catch((err) => {
      console.error('[server] executor sweep failed:', err);
    });
  }, Math.max(15000, Math.floor(EXECUTOR_HEARTBEAT_TIMEOUT_MS / 2)));
  sweepInterval.unref?.();

  const { startTrajectoryIdleReaper } = await import('./src/services/trajectory-idle-reaper.js');
  startTrajectoryIdleReaper();

  const server = httpServer.listen(PORT, HOST, () => {
    console.log(`[server] JS-gen control plane listening on http://${HOST}:${PORT}`);
    console.log(`[server] WebSocket at ws://${HOST}:${PORT}/ws`);
    console.log(`[server] Executor WebSocket at ws://${HOST}:${PORT}/ws/executor`);
    console.log(`[server] Key endpoints:`);
    console.log(`  GET  /api/health`);
    console.log(`  GET  /api/v2/system-mgmt/tree`);
    console.log(`  GET  /api/v2/trajectories`);
    console.log(`  POST /api/v2/trajectories/:id/record/prepare|start|stop`);
    console.log(`  POST /api/v2/trajectories/:id/attach|detach`);
    console.log(`  POST /api/v2/trajectories/:id/replay/prepare|start|stop`);
    console.log(`  GET  /api/v2/executors`);
    console.log(`  GET  /api/v2/case-data`);
    console.log(`  POST /api/browser/session  (debug)`);
    console.log(`  POST /api/test/assemble | /api/test/run`);
    console.log(`  GET  /api/docs  (product API docs for frontend)`);
    console.log(`  GET  /api/test  (engineering dashboard)`);
    console.log(`  GET  /api/test/record-console  (self-use recording console)`);
    console.log(`  GET  /api/test/record-studio?id=  (recording studio)`);
    console.log(`  GET  /api/trajectory|/api/case-data  → 410 Gone (use /api/v2/*)`);
    console.log(`  GET  /v1/models | POST /v1/chat/completions`);
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

async function gracefulShutdown() {
  console.log('\n[server] Shutting down...');
  try {
    const { closeDB } = await import('./config/database.js');
    await closeDB();
  } catch {}
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
