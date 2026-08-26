/**
 * Shared Playwright script execution for /api/test/run and trajectory replay.
 */
import { writeFileSync, readFileSync, readdirSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import { TMP_DIR, SKILL_DIR } from '../../config/config.js';
import { cleanupScriptFile } from '../script-utils.js';
import { killTree } from './agent-process.js';

let _isExecuting = false;
/** @type {{ pid: number|null, abort: () => void }|null} */
let _activeRun = null;

/**
 * True when a Playwright script is currently executing.
 * @returns {boolean} 是否有脚本正在执行
 */
export function isScriptExecuting() {
  return _isExecuting;
}

/**
 * Abort the active script run if one is in progress.
 * @returns {boolean} 是否成功中止了脚本执行
 */
export function abortActiveScriptRun() {
  if (_activeRun) {
    _activeRun.abort();
    return true;
  }
  return false;
}

/**
 * Isolated per-run directory under TMP_DIR for script + artifacts
 * (script-errors.json, step-*.png). Left in place after the run so
 * /api/test/screenshots still serves nested paths while clients fetch.
 * @returns {string} absolute path to the created run directory
 */
function createRunDir() {
  const runDir = path.join(TMP_DIR, `pw-run-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

function childEnv(runDir) {
  return {
    ...process.env,
    TMPDIR: runDir,
    TMP: runDir,
    TEMP: runDir,
    PLAYWRIGHT_SKIP_EXISTING: '1',
  };
}

/**
 * Relative path from TMP_DIR for express.static URL segments.
 * @param {string} runDir absolute path to the run directory
 * @returns {string} relative path suitable for URL segments
 */
function runDirUrlPrefix(runDir) {
  return path.relative(TMP_DIR, runDir).split(path.sep).join('/');
}

/**
 * Read and parse script-errors.json from a Playwright run.
 * @param {string} scriptPath script path
 * @param {number|null} code exit code
 * @param {string} [logSuffix] log suffix
 * @param {string} [runDir] directory that received TMPDIR for this run
 * @returns {{ scriptErrors: object[]|null, success: boolean }} 检查结果，包含错误信息和执行状态
 */
export function checkScriptErrors(scriptPath, code, logSuffix = '', runDir = TMP_DIR) {
  let scriptErrors = null;
  const errorReportPath = path.join(runDir, 'script-errors.json');
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

function listNewScreenshots(beforeFiles, runDir) {
  if (!existsSync(runDir)) return [];
  const afterFiles = readdirSync(runDir).filter((f) => f.endsWith('.png'));
  const newScreenshots = afterFiles.filter((f) => !beforeFiles.has(f));
  const prefix = runDirUrlPrefix(runDir);
  const stepIndex = (f) => parseInt(f.match(/^step-(\d+)-/)?.[1] ?? '0', 10);
  const kindOf = (f) => {
    if (/-before-/.test(f)) return 'before';
    if (/-after-/.test(f)) return 'after';
    return 'after';
  };
  return newScreenshots
    .sort((a, b) => {
      const d = stepIndex(a) - stepIndex(b);
      if (d !== 0) return d;
      return kindOf(a) === 'before' ? -1 : 1;
    })
    .map((f) => ({
      fileName: f,
      url: `/api/test/screenshots/${prefix}/${f}`,
      stepNumber: stepIndex(f) || null,
      kind: kindOf(f),
      absolutePath: path.join(runDir, f),
    }));
}

/**
 * Find screenshot(s) for assembler step N.
 * @param {number} stepNumber step number
 * @param {Array} screenshotList screenshot list
 * @param {'before'|'after'|null} [kind] if set, return that kind only; else return newest match
 * @returns {object|null} 找到的截图对象或null
 */
export function findScreenshotForStep(stepNumber, screenshotList, kind = null) {
  const n = Number(stepNumber);
  let matches = (screenshotList || []).filter((s) => s.stepNumber === n || s.fileName?.startsWith(`step-${n}-`));
  if (kind) matches = matches.filter((s) => s.kind === kind || s.fileName?.includes(`-${kind}-`));
  return matches.length ? matches[matches.length - 1] : null;
}

/**
 * Find both before/after screenshots for assembler step N.
 * @param {number} stepNumber step number
 * @param {Array} screenshotList screenshot list
 * @returns {{ before: object|null, after: object|null }} 包含before和after截图的对象
 */
export function findScreenshotsForStep(stepNumber, screenshotList) {
  return {
    before: findScreenshotForStep(stepNumber, screenshotList, 'before'),
    after: findScreenshotForStep(stepNumber, screenshotList, 'after'),
  };
}

/**
 * Parse __REPLAY_STEP__{...} lines from Playwright stdout.
 * @param {string} line stdout行内容
 * @returns {object|null} 解析结果或null
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
 * @param {object} opts 执行选项
 * @param {string} opts.script Playwright脚本内容
 * @param {string} [opts.fileName] 文件名
 * @param {{ send: (event: string, data: unknown) => void, end: () => void, onAbort: (handler: () => void) => void }} opts.channel 通信通道
 * @param {{
 *   onStdoutLine?: (line: string, ctx: { screenshotsSoFar: () => object[] }) => void,
 *   keepScriptFile?: boolean,
 *   busyMessage?: string,
 * }} [opts.hooks] 钩子函数
 * @returns {{ abort: () => void }|null} 中止函数，如果繁忙则返回null
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

  const runDir = createRunDir();
  const scriptName = fileName
    ? fileName.replace(/[\\/:*?"<>|]/g, '_')
    : `playwright-test-${Date.now()}.js`;
  const scriptPath = path.join(runDir, scriptName);
  writeFileSync(scriptPath, script, 'utf-8');
  send('log', { type: 'info', message: `Script saved: ${scriptPath}` });

  const beforeFiles = new Set(
    existsSync(runDir) ? readdirSync(runDir).filter((f) => f.endsWith('.png')) : [],
  );
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
    env: childEnv(runDir),
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
      knownScreenshots = listNewScreenshots(beforeFiles, runDir);
      if (hooks.onStdoutLine) {
        hooks.onStdoutLine(line, {
          screenshotsSoFar: () => listNewScreenshots(beforeFiles, runDir),
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

    const screenshots = listNewScreenshots(beforeFiles, runDir);
    if (screenshots.length > 0) {
      send('log', { type: 'success', message: `Captured ${screenshots.length} screenshot(s)` });
      send('screenshots', { screenshots });
    }

    const { scriptErrors, success } = checkScriptErrors(scriptPath, code, '', runDir);

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
    // Keep runDir (pngs) for /api/test/screenshots nested URLs; only drop the .js if allowed.
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
 * Execute a Playwright script synchronously and return the result (for /api/test/run-sync).
 * @param {object} opts 执行选项
 * @param {string} opts.script Playwright脚本内容
 * @param {string} [opts.fileName] 文件名
 * @returns {Promise<{ success: boolean, exitCode: number, stdout: string, stderr: string, screenshots: object[], scriptErrors?: object[], needsFix?: boolean }>} 执行结果
 */
export async function executeScriptSync({ script, fileName }) {
  const runDir = createRunDir();
  const scriptName = fileName
    ? fileName.replace(/[\\/:*?"<>|]/g, '_')
    : `playwright-test-${Date.now()}.js`;
  const scriptPath = path.join(runDir, scriptName);
  writeFileSync(scriptPath, script, 'utf-8');

  const beforeFiles = new Set(
    existsSync(runDir) ? readdirSync(runDir).filter((f) => f.endsWith('.png')) : [],
  );
  const runJsPath = path.join(SKILL_DIR, 'run.cjs');

  if (!existsSync(runJsPath)) {
    cleanupScriptFile(scriptPath);
    throw new Error('run.cjs not found');
  }

  try {
    const { stdout, stderr, code } = await new Promise((resolve, reject) => {
      const child = spawn('node', [runJsPath, scriptPath], {
        cwd: SKILL_DIR,
        env: childEnv(runDir),
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { err += c; });
      child.on('close', (c) => resolve({ stdout: out, stderr: err, code: c }));
      child.on('error', reject);
    });

    const screenshots = listNewScreenshots(beforeFiles, runDir);
    const { scriptErrors, success } = checkScriptErrors(scriptPath, code, 'sync', runDir);

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
