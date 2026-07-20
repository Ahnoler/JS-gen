import { spawn, execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import os from 'os';
import { PROJECT_DIR, PYTHON_EXE as PYTHON_EXE_CONFIG } from '../../config/config.js';
import { state } from '../state.js';

export const PYTHON_EXE = PYTHON_EXE_CONFIG;
export const AGENT_SCRIPT = path.join(PROJECT_DIR, 'scripts', 'browser-use-agent.py');

export function killTree(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', timeout: 5000 });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {}
}

export function killOrphans() {
  try {
    if (process.platform === 'win32') {
      const psScript = path.join(os.tmpdir(), `_kill_bu_orphans_${Date.now()}.ps1`);
      writeFileSync(psScript, `
$procs = Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | Where-Object { $_.CommandLine -match 'remote.debugging.(port|pipe)|playwright|browser.use|\.agent-browser|openclaw|xbrowser' }
foreach ($p in $procs) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
`, 'utf-8');
      execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScript}"`, {
        stdio: 'ignore', timeout: 10000, windowsHide: true,
      });
      try { unlinkSync(psScript); } catch {}
    }
  } catch {}
}

export function flushPendingBuffer(pendingBuffer, onMessage) {
  const trimmed = pendingBuffer.trim();
  if (!trimmed) return;
  for (const line of trimmed.split('\n')) {
    if (!line.trim()) continue;
    try { onMessage(JSON.parse(line)); } catch {}
  }
}

export function waitForReady(child, timeout = 15000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout waiting for Python agent ready'));
    }, timeout);

    const onStdout = (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.event === 'ready') {
            cleanup();
            resolve(msg);
          }
        } catch {}
      }
    };

    const onExit = (code) => {
      cleanup();
      reject(new Error(`Python agent exited with code ${code} before ready`));
    };

    function cleanup() {
      clearTimeout(timer);
      child.stdout.removeListener('data', onStdout);
      child.removeListener('exit', onExit);
    }

    child.stdout.on('data', onStdout);
    child.on('exit', onExit);
  });
}

export function isProcessAlive(proc) {
  if (!proc) return false;
  if (proc.killed) return false;
  if (proc.exitCode !== null) return false;
  return true;
}

export function spawnAgent(args, extraEnv = {}) {
  return spawn(PYTHON_EXE, ['-m', 'scripts.main', ...args], {
    cwd: PROJECT_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
      PYTHONPATH: PROJECT_DIR,
      ...extraEnv,
    },
  });
}

export function setupSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (res.socket) {
    res.socket.setNoDelay(true);
    res.socket.setKeepAlive(true, 30000);
  }
  return (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

/**
 * Create a dual push channel that sends to WebSocket AND/OR SSE.
 * When WS is available, events go via WS; SSE is used as fallback.
 * @param {object|null} ws - WebSocket client (or null)
 * @param {object|null} res - Express response (or null)
 * @param {string} [ns='session'] - WS event namespace prefix
 * Returns { send, end, onAbort }
 */
export function createPushChannel(ws, res, ns = 'session') {
  const channel = { ended: false };
  channel.send = (event, data) => {
    if (channel.ended) return;
    // WS path (preferred)
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: `${ns}:${event}`, payload: data }));
    }
    // SSE fallback
    if (res && !res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };
  channel.end = () => {
    channel.ended = true;
    if (res && !res.writableEnded) res.end();
  };
  channel.onAbort = (handler) => {
    if (res) res.on('close', handler);
    if (ws) ws.on('close', handler);
  };
  return channel;
}

export function resolveModelId(model) {
  if (model) {
    // Strip providerID prefix if present (e.g. "deepseek/deepseek-v4-flash" -> "deepseek-v4-flash")
    const parts = model.split('/');
    return parts.length >= 2 ? parts.slice(1).join('/') : model;
  }
  if (!state.defaultModel) return 'deepseek-v4-flash';
  return state.defaultModel.modelID;
}
