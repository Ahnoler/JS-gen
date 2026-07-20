/**
 * Shared Playwright script execution for /api/test/run and trajectory replay.
 */
import { writeFileSync, readFileSync, readdirSync, existsSync, unlinkSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { TMP_DIR, SKILL_DIR } from '../../config/config.js';
import { cleanupScriptFile } from '../script-utils.js';
import { killTree } from '../routes/explore-utils.js';

let _isExecuting = false;
/** @type {{ pid: number|null, abort: () => void }|null} */
let _activeRun = null;

export function isScriptExecuting() {
  return _isExecuting;
}

export function abortActiveScriptRun() {
  if (_activeRun) {
    _activeRun.abort();
    return true;
  }
  return false;
}

/**
 * Read and parse script-errors.json from a Playwright run.
 * @returns {{ scriptErrors: object[]|null, success: boolean }}
 */
export function checkScriptErrors(scriptPath, code, logSuffix = '') {
  let scriptErrors = null;
  const errorReportPath = path.join(TMP_DIR, 'script-errors.json');
  try {
    if (existsSync(errorReportPath)) {
      scriptErrors = JSON.parse(readFileSync(errorReportPath, 'utf-8'));
      unlinkSync(errorReportPath);
    }
  } catch {}

  const success = code === 0 && (!scriptErrors || scriptErrors.length === 0);
  const suffix = logSuffix ? ` (${logSuffix})` : '';

  if (scriptErrors && scriptErrors.length > 0) {
    console.log('═══════════════════════════════════════════');
    console.log(`⚠  SCRIPT ERRORS DETECTED${suffix}: ` + scriptErrors.length + ' error(s)');
    console.log('───────────────────────────────────────────');
    scriptErrors.forEach((e) => {
      console.log('[Step ' + e.step + '] ' + e.action + ' "' + (e.label || '') + '" → ' + e.error);
      if (e.details) console.log('  Details: ' + e.details);
      if (e.value) console.log('  Value: ' + e.value);
    });
    console.log('───────────────────────────────────────────');
    console.log('  Script: ' + scriptPath);
    console.log('  Exit code: ' + code);
    console.log('═══════════════════════════════════════════');
  }

  return { scriptErrors, success };
}

function listNewScreenshots(beforeFiles) {
  const afterFiles = readdirSync(TMP_DIR).filter((f) => f.endsWith('.png'));
  const newScreenshots = afterFiles.filter((f) => !beforeFiles.has(f));
  const stepIndex = (f) => parseInt(f.match(/^step-(\d+)-/)?.[1] ?? '0', 10);
  return newScreenshots
    .sort((a, b) => stepIndex(a) - stepIndex(b))
    .map((f) => ({
      fileName: f,
      url: `/api/test/screenshots/${f}`,
      stepNumber: stepIndex(f) || null,
    }));
}

/**
 * Find screenshot for assembler step N among known files (newest match).
 */
export function findScreenshotForStep(stepNumber, screenshotList) {
  const n = Number(stepNumber);
  const matches = (screenshotList || []).filter((s) => s.stepNumber === n || s.fileName?.startsWith(`step-${n}-`));
  return matches.length ? matches[matches.length - 1] : null;
}

/**
 * Parse __REPLAY_STEP__{...} lines from Playwright stdout.
 * @returns {object|null}
 */
export function parseReplayStepMarker(line) {
  const idx = line.indexOf('__REPLAY_STEP__');
  if (idx === -1) return null;
  const raw = line.slice(idx + '__REPLAY_STEP__'.length).trim();
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Execute a Playwright script and push events via channel.send(event, payload).
 *
 * @param {object} opts
 * @param {string} opts.script
 * @param {string} [opts.fileName]
 * @param {{ send: Function, end: Function, onAbort: Function }} opts.channel
 * @param {{
 *   onStdoutLine?: (line: string, ctx: { screenshotsSoFar: Function }) => void,
 *   keepScriptFile?: boolean,
 *   busyMessage?: string,
 * }} [opts.hooks]
 * @returns {{ abort: () => void }|null} null if busy
 */
export function executeScript({ script, fileName, channel, hooks = {} }) {
  const send = channel.send;

  if (_isExecuting) {
    send('log', { type: 'error', message: hooks.busyMessage || '另一个测试正在执行中,请等待完成' });
    send('done', {});
    channel.end();
    return null;
  }
  _isExecuting = true;
  const finishExecuting = () => {
    _isExecuting = false;
    _activeRun = null;
  };

  let aborted = false;
  channel.onAbort(() => { aborted = true; });

  const scriptName = fileName
    ? fileName.replace(/[\\/:*?"<>|]/g, '_')
    : `playwright-test-${Date.now()}.js`;
  const scriptPath = path.join(TMP_DIR, scriptName);
  writeFileSync(scriptPath, script, 'utf-8');
  send('log', { type: 'info', message: `Script saved: ${scriptPath}` });

  const beforeFiles = new Set(readdirSync(TMP_DIR).filter((f) => f.endsWith('.png')));
  /** @type {ReturnType<typeof listNewScreenshots>} */
  let knownScreenshots = [];

  const runJsPath = path.join(SKILL_DIR, 'run.cjs');
  if (!existsSync(runJsPath)) {
    send('log', { type: 'error', message: `run.cjs not found at ${runJsPath}` });
    send('result', { success: false, error: `run.cjs not found` });
    send('done', {});
    finishExecuting();
    cleanupScriptFile(scriptPath);
    channel.end();
    return null;
  }

  send('log', { type: 'step', message: `Executing: node run.cjs ${scriptPath}` });
  send('status', { phase: 'running', label: 'Executing Playwright script...' });

  const child = spawn('node', [runJsPath, scriptPath], {
    cwd: SKILL_DIR,
    env: { ...process.env, PLAYWRIGHT_SKIP_EXISTING: '1' },
  });

  const abort = () => {
    aborted = true;
    finishExecuting();
    if (child.pid) killTree(child.pid);
    if (!hooks.keepScriptFile) cleanupScriptFile(scriptPath);
  };

  _activeRun = { pid: child.pid || null, abort };

  channel.onAbort(() => {
    abort();
  });

  let stdout = '';
  let stderr = '';
  let lineBuf = '';

  child.stdout.on('data', (chunk) => {
    if (aborted) return;
    const text = chunk.toString();
    stdout += text;
    send('log', { type: 'info', message: text.trimEnd() });

    lineBuf += text;
    const parts = lineBuf.split(/\r?\n/);
    lineBuf = parts.pop() || '';
    for (const line of parts) {
      knownScreenshots = listNewScreenshots(beforeFiles);
      if (hooks.onStdoutLine) {
        hooks.onStdoutLine(line, {
          screenshotsSoFar: () => listNewScreenshots(beforeFiles),
        });
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    if (aborted) return;
    const text = chunk.toString();
    stderr += text;
    send('log', { type: 'error', message: text.trimEnd() });
  });

  child.on('close', async (code) => {
    if (aborted) return;
    send('log', { type: 'step', message: `Process exited with code ${code}` });

    const screenshots = listNewScreenshots(beforeFiles);
    if (screenshots.length > 0) {
      send('log', { type: 'success', message: `Captured ${screenshots.length} screenshot(s)` });
      send('screenshots', { screenshots });
    }

    const { scriptErrors, success } = checkScriptErrors(scriptPath, code);

    if (scriptErrors && scriptErrors.length > 0) {
      send('script-errors', { errors: scriptErrors, needsFix: true, scriptPath });
    }

    send('status', { phase: 'done', label: success ? 'Test completed' : 'Test failed', success });

    send('result', {
      success,
      exitCode: code,
      stdout: stdout.slice(-2000),
      stderr: stderr.slice(-2000),
      screenshots,
      scriptPath,
      scriptErrors: scriptErrors || undefined,
    });

    send('done', {});
    finishExecuting();
    if (!hooks.keepScriptFile) cleanupScriptFile(scriptPath);
    channel.end();
  });

  child.on('error', (err) => {
    if (aborted) return;
    send('log', { type: 'error', message: err.message });
    send('result', { success: false, error: err.message });
    send('done', {});
    finishExecuting();
    if (!hooks.keepScriptFile) cleanupScriptFile(scriptPath);
    channel.end();
  });

  return { abort };
}

/**
 * Sync run (for /api/test/run-sync).
 */
export async function executeScriptSync({ script, fileName }) {
  const scriptName = fileName
    ? fileName.replace(/[\\/:*?"<>|]/g, '_')
    : `playwright-test-${Date.now()}.js`;
  const scriptPath = path.join(TMP_DIR, scriptName);
  writeFileSync(scriptPath, script, 'utf-8');

  const beforeFiles = new Set(readdirSync(TMP_DIR).filter((f) => f.endsWith('.png')));
  const runJsPath = path.join(SKILL_DIR, 'run.cjs');

  if (!existsSync(runJsPath)) {
    cleanupScriptFile(scriptPath);
    throw new Error('run.cjs not found');
  }

  try {
    const { stdout, stderr, code } = await new Promise((resolve, reject) => {
      const child = spawn('node', [runJsPath, scriptPath], {
        cwd: SKILL_DIR,
        env: { ...process.env, PLAYWRIGHT_SKIP_EXISTING: '1' },
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { err += c; });
      child.on('close', (c) => resolve({ stdout: out, stderr: err, code: c }));
      child.on('error', reject);
    });

    const screenshots = listNewScreenshots(beforeFiles);
    const { scriptErrors, success } = checkScriptErrors(scriptPath, code, 'sync');

    return {
      success,
      exitCode: code,
      stdout: stdout.slice(-2000),
      stderr: stderr.slice(-2000),
      screenshots,
      ...(scriptErrors && scriptErrors.length > 0 ? { scriptErrors, needsFix: true } : {}),
    };
  } finally {
    cleanupScriptFile(scriptPath);
  }
}
