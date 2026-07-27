/**
 * Spawn Python browser-use session subprocess (executor-side).
 */
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { PROJECT_ROOT, PYTHON_EXE, buildPythonSubprocessEnv } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function isProcessAlive(proc) {
  if (!proc) return false;
  if (proc.killed) return false;
  if (proc.exitCode !== null) return false;
  return true;
}

export function killTree(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', timeout: 5000 });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {}
}

/** Kill only the agent PID — leave child Chromium running for CDP reuse. */
export function killProcessOnly(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore', timeout: 5000 });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch {}
}

/**
 * Best-effort: kill whatever still listens on a CDP port (orphan Chromium).
 * @param {number} port
 */
export function killListenerOnPort(port) {
  const p = Number(port);
  if (!Number.isFinite(p) || p <= 0) return;
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${p}`, {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const pids = new Set();
      for (const line of String(out).split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue;
        const m = line.trim().match(/(\d+)\s*$/);
        if (m) pids.add(m[1]);
      }
      for (const pid of pids) {
        if (pid === '0') continue;
        try {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', timeout: 5000 });
        } catch {}
      }
    } else {
      execSync(`fuser -k ${p}/tcp`, { stdio: 'ignore', timeout: 5000 });
    }
  } catch {}
}

export function waitForReady(child, timeout = 60000) {
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

/**
 * @param {string[]} args CLI args after scripts.main
 * @param {Record<string, string>} [extraEnv]
 */
export function spawnAgent(args, extraEnv = {}) {
  return spawn(PYTHON_EXE, ['-m', 'scripts.main', ...args], {
    cwd: PROJECT_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: buildPythonSubprocessEnv(extraEnv),
  });
}
