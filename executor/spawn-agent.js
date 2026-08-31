/**
 * Spawn Python browser-use session subprocess (executor-side).
 */
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { PROJECT_ROOT, PYTHON_EXE, buildPythonSubprocessEnv } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * True when the process handle is still running (not killed, no exit code).
 * @param {import('child_process').ChildProcess|null} proc proc
 * @returns {boolean} result
 */
export function isProcessAlive(proc) {
  if (!proc) return false;
  if (proc.killed) return false;
  if (proc.exitCode !== null) return false;
  return true;
}

/**
 * Kill a process and its entire child tree.
 * @param {number} pid pid
 * @returns {void} result
 */
export function killTree(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', timeout: 5000 });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {}
}

/**
 * Kill only the agent PID — leave child Chromium running for CDP reuse.
 * @param {number} pid pid
 * @returns {void} result
 */
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
 * Extract PIDs listening on an exact local port from `netstat -ano` output.
 * Only matches the local-address column where `:<port>` is not followed by
 * another digit, so ports like 19224 / 49242 / 92421 never match port 9242.
 * @param {string} netstatOutput raw stdout of `netstat -ano`
 * @param {number} port exact port number to match
 * @returns {string[]} unique PIDs (as strings) with a LISTENING socket on that port
 */
export function parseListeningPids(netstatOutput, port) {
  const portRe = new RegExp(`:${port}(?!\\d)`);
  const pids = new Set();
  for (const line of String(netstatOutput).split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    const cols = line.trim().split(/\s+/);
    // netstat -ano columns: Proto, Local Address, Foreign Address, State, PID
    if (cols.length < 4) continue;
    const localAddr = cols[1];
    if (portRe.test(localAddr)) {
      const pid = cols[cols.length - 1];
      if (/^\d+$/.test(pid)) pids.add(pid);
    }
  }
  return [...pids];
}

/**
 * Best-effort: kill whatever still listens on a CDP port (orphan Chromium).
 * @param {number} port port
 * @returns {void} result
 */
export function killListenerOnPort(port) {
  const p = Number(port);
  if (!Number.isFinite(p) || p <= 0) return;
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano', {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const pids = parseListeningPids(String(out), p);
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

/**
 * Wait for the Python agent to emit a `ready` event on stdout.
 * @param {import('child_process').ChildProcess} child spawned agent process
 * @param {number} [timeout] max wait in ms (default 60000)
 * @returns {Promise<object>} the ready message payload
 */
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
 * Spawn the Python browser-use session subprocess (executor-side).
 * @param {string[]} args CLI args after `scripts.main`
 * @param {Record<string, string>} [extraEnv] extra env
 * @returns {import('child_process').ChildProcess} result
 */
export function spawnAgent(args, extraEnv = {}) {
  return spawn(PYTHON_EXE, ['-m', 'scripts.main', ...args], {
    cwd: PROJECT_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: buildPythonSubprocessEnv(extraEnv),
  });
}
