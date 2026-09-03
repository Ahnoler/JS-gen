import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { PORT, HOST, DASHBOARD_DIR, PROJECT_DIR, EXECUTOR_HEARTBEAT_TIMEOUT_MS, LLM_MODEL } from '#config/config.js';
import { state, isConfigured } from './src/state.js';
import { initWebSocket } from './src/ws-server.js';
import { initExecutorWs, validateExecutorToken, rejectUpgrade } from './src/executor-ws.js';
import * as executorService from './src/services/executor-node-service.js';
import registerHealthRoutes from './src/routes/health.js';
import registerAgentRoutes from './src/routes/agent.js';

import registerLLMProxyRoutes from './src/routes/llm-proxy.js';
import registerBrowserSessionRoutes from './src/routes/browser-session.js';
import registerLegacyGoneRoutes from './src/routes/legacy-gone.js';
import registerSetupRoutes from './src/routes/setup.js';
import registerV2Routes from './src/routes/v2/__init__.js';
import { startPendingScreenshotRetry, stopPendingScreenshotRetry } from './src/services/screenshot-pending-retry.js';
import { cleanupPendingFiles } from './src/services/screenshot-pending-store.js';
import * as screenshotDao from './src/dao/screenshot-dao.js';
import { purgeMissingLocalScreenshots } from './src/services/screenshot-service.js';

const app = express();
app.use(express.json({ limit: '10mb' }));
// 静态托管仅限监控台页面资源（不再暴露项目根目录与 scripts/ —— 控制面与执行机解耦）。
app.use('/src/dashboard', express.static(path.join(PROJECT_DIR, 'src', 'dashboard'), {
  maxAge: 0,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store');
  },
}));
app.get('/', (req, res) => res.sendFile(path.join(PROJECT_DIR, 'api-docs.html')));
app.get('/api-docs.html', (req, res) => res.sendFile(path.join(PROJECT_DIR, 'api-docs.html')));

// Register all route modules
registerLLMProxyRoutes(app);
registerBrowserSessionRoutes(app);
// Legacy JSON catalogs: return 410 Gone → use /api/v2/trajectories|business-data
registerLegacyGoneRoutes(app);
registerHealthRoutes(app);
registerAgentRoutes(app);

registerSetupRoutes(app);
registerV2Routes(app);

// 301 redirect: legacy /api/v2/case-data → /api/v2/business-data
app.use((req, res, next) => {
  if (req.path.startsWith('/api/v2/case-data')) {
    return res.redirect(301, req.path.replace('/api/v2/case-data', '/api/v2/business-data'));
  }
  next();
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: err.message || 'Internal server error' });
});

function loadDefaultModel() {
  // Single source of truth: .env LLM_MODEL (via config/config.js).
  // modelID keeps the provider prefix — the gateway requires the full model
  // name (e.g. "Qwen/Qwen3.5-35B-A3B"); stripping it 404s.
  const parts = LLM_MODEL.split('/');
  state.defaultModel = { providerID: parts.length >= 2 ? parts[0] : '', modelID: LLM_MODEL };
}

async function main() {
  loadDefaultModel();
  if (state.defaultModel) {
    console.log(`[server] Default model: ${state.defaultModel.providerID}/${state.defaultModel.modelID}`);
  }

  if (!isConfigured()) {
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

  const { startTrajectoryIdleReaper } = await import('./src/services/trajectory/trajectory-idle-reaper.js');
  startTrajectoryIdleReaper();

  // Screenshot local pending upload: drop DB orphans without files, clean orphan
  // files, then start the retry loop.
  try {
    const purged = await purgeMissingLocalScreenshots();
    if (purged.deleted) {
      console.warn(
        `[server] purged ${purged.deleted}/${purged.scanned} local screenshot row(s) with missing pending file`,
      );
    }
    const pendingScreenshots = await screenshotDao.listPending();
    await cleanupPendingFiles(pendingScreenshots.map((p) => p.id));
  } catch (err) {
    console.warn('[server] screenshot pending cleanup skipped:', err?.message || err);
  }
  startPendingScreenshotRetry();

  // Do NOT crash occupied remote_sessions at raw boot — executor nodes look offline
  // until they reconnect. Defer reconcile until after the reconnect window.
  const BOOT_RECONCILE_DELAY_MS = Number(process.env.BOOT_REMOTE_RECONCILE_MS) || 15000;
  setTimeout(() => {
    (async () => {
      try {
        const remoteSessionDao = await import('./src/dao/remote-session-dao.js');
        const n = await remoteSessionDao.crashOccupiedOnOfflineNodes();
        if (n) console.log(`[server] crashed ${n} occupied remote_session(s) on offline nodes`);
      } catch (err) {
        console.warn('[server] deferred remote_session reconcile skipped:', err.message);
      }
      try {
        const remoteSessionService = await import('./src/services/remote-session-service.js');
        const cleared = await remoteSessionService.reconcileStaleTrajectoryRemoteMounts();
        if (cleared.length) {
          console.log(`[server] cleared ${cleared.length} stale trajectory.remote_session_id mount(s): ${cleared.join(',')}`);
        }
      } catch (err) {
        console.warn('[server] stale remote mount reconcile skipped:', err.message);
      }
      try {
        const sessionLifecycle = await import('./src/services/session-lifecycle.js');
        await sessionLifecycle.expireAllDueGrace().catch(() => {});
      } catch (err) {
        console.warn('[server] grace expiry on boot skipped:', err.message);
      }
      try {
        const batchService = await import('./src/services/trajectory/index.js');
        await batchService.recoverBatchJobsOnStartup();
      } catch (err) {
        console.warn('[server] batch recovery skipped:', err.message);
        try {
          const batchService = await import('./src/services/trajectory/index.js');
          batchService.startBatchScheduler();
        } catch {}
      }
    })().catch(() => {});
  }, BOOT_RECONCILE_DELAY_MS).unref?.();

  const server = httpServer.listen(PORT, HOST, () => {
    console.log(`[server] JS-gen control plane listening on http://${HOST}:${PORT}`);
    console.log(`[server] WebSocket at ws://${HOST}:${PORT}/ws`);
    console.log(`[server] Executor WebSocket at ws://${HOST}:${PORT}/ws/executor`);
    console.log(`[server] Key endpoints:`);
    console.log(`  GET  /api/health`);
    console.log(`  GET  /api/v2/system-mgmt/tree`);
    console.log(`  GET  /api/v2/trajectories`);
    console.log(`  POST /api/v2/trajectories/:id/record/prepare|start|stop`);
    console.log(`  POST /api/v2/trajectories/:id/stream/detach | attach|detach`);
    console.log(`  GET  /api/v2/executors`);
    console.log(`  GET  /api/v2/business-data`);
    console.log(`  GET  /api/v2/system-ref-data`);
    console.log(`  POST /api/browser/session  (debug)`);
    console.log(`  GET  /api/docs  (product API docs for frontend)`);
    console.log(`  GET  /api/test|/record-console|/record-studio  → 301 /api/docs (UI removed)`);
    console.log(`  GET  /api/trajectory|/api/business-data  → 410 Gone (use /api/v2/*)`);
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
  stopPendingScreenshotRetry();
  try {
    const { closeDB } = await import('./config/database.js');
    await closeDB();
  } catch {}
  process.exit(0);
}

// 全局兜底：孤儿 rejection 记日志不打崩进程（会话事件等待的超时 reject 孤儿曾打崩进程）
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
