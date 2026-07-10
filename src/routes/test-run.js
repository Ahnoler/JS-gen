import { writeFileSync, readFileSync, readdirSync, existsSync, unlinkSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { TMP_DIR, SKILL_DIR } from '../../config/config.js';
import { cleanupScriptFile } from '../script-utils.js';
import { createPushChannel, killTree } from './explore-utils.js';
import { onWsMessage } from '../ws-server.js';

/**
 * Read and parse the script-errors.json report written by a failed Playwright run.
 * Prints structured diagnostics to server console, deletes the file after reading.
 * Returns { scriptErrors, success } — caller decides how to relay to client.
 */
function checkScriptErrors(scriptPath, code, logSuffix = '') {
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
    // ============================================================
    // DETECTION PHASE — 检测到脚本执行错误，打印详细日志
    // ============================================================
    console.log('═══════════════════════════════════════════');
    console.log(`⚠  SCRIPT ERRORS DETECTED${suffix}: ` + scriptErrors.length + ' error(s)');
    console.log('───────────────────────────────────────────');
    scriptErrors.forEach((e, i) => {
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

export default function (app) {
  // ── Shared: execute a Playwright script and push results via channel ──
  let _isExecuting = false;
  function executeScript({ script, fileName, channel }) {
    const send = channel.send;

    // 并发守卫:防止 WS 重连或重复点击导致两个 Playwright 同时运行
    if (_isExecuting) {
      send('log', { type: 'error', message: '另一个测试正在执行中,请等待完成' });
      send('done', {});
      channel.end();
      return;
    }
    _isExecuting = true;
    const finishExecuting = () => { _isExecuting = false; };

    let aborted = false;
    channel.onAbort(() => { aborted = true; });

    const scriptName = fileName ? fileName.replace(/[\\/:*?"<>|]/g, '_') : `playwright-test-${Date.now()}.js`;
    const scriptPath = path.join(TMP_DIR, scriptName);
    writeFileSync(scriptPath, script, 'utf-8');
    send('log', { type: 'info', message: `Script saved: ${scriptPath}` });

    const beforeFiles = new Set(readdirSync(TMP_DIR).filter(f => f.endsWith('.png')));

    const runJsPath = path.join(SKILL_DIR, 'run.cjs');
    if (!existsSync(runJsPath)) {
      send('log', { type: 'error', message: `run.cjs not found at ${runJsPath}` });
      send('result', { success: false, error: `run.cjs not found` });
      send('done', {});
      finishExecuting();
      cleanupScriptFile(scriptPath);
      channel.end();
      return;
    }

    send('log', { type: 'step', message: `Executing: node run.cjs ${scriptPath}` });
    send('status', { phase: 'running', label: 'Executing Playwright script...' });

    const child = spawn('node', [runJsPath, scriptPath], {
      cwd: SKILL_DIR,
      env: { ...process.env, PLAYWRIGHT_SKIP_EXISTING: '1' },
    });

    channel.onAbort(() => {
      finishExecuting();
      // Windows 下 child.kill() 不级联杀子进程,用 killTree 连同 Chrome 一起清理
      if (child.pid) killTree(child.pid);
      cleanupScriptFile(scriptPath);
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      if (aborted) return;
      const text = chunk.toString();
      stdout += text;
      send('log', { type: 'info', message: text.trimEnd() });
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

      const afterFiles = readdirSync(TMP_DIR).filter(f => f.endsWith('.png'));
      const newScreenshots = afterFiles.filter(f => !beforeFiles.has(f));
      // 按 step-{index}-{timestamp}-{hash}.png 中的 index 数值排序
      const stepIndex = (f) => parseInt(f.match(/^step-(\d+)-/)?.[1] ?? '0', 10);
      const screenshots = newScreenshots
        .sort((a, b) => stepIndex(a) - stepIndex(b))
        .map(f => ({
          fileName: f,
          url: `/api/test/screenshots/${f}`,
        }));

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
      });

      send('done', {});
      finishExecuting();
      cleanupScriptFile(scriptPath);
      channel.end();
    });

    child.on('error', (err) => {
      if (aborted) return;
      send('log', { type: 'error', message: err.message });
      send('result', { success: false, error: err.message });
      send('done', {});
      finishExecuting();
      cleanupScriptFile(scriptPath);
      channel.end();
    });
  }

  app.post('/api/test/run', (req, res) => {
    const { script, fileName } = req.body || {};
    if (!script) return res.status(400).json({ error: 'script is required' });

    // SSE headers
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

    const channel = createPushChannel(null, res, 'execution');
    executeScript({ script, fileName, channel });
  });

  // ── WebSocket handler ──
  onWsMessage((ws, msg) => {
    if (msg.type === 'execution:start') {
      const { script, fileName } = msg.payload || {};
      if (!script) {
        ws.send(JSON.stringify({ type: 'execution:error', payload: { message: 'script is required' } }));
        return;
      }
      const channel = createPushChannel(ws, null, 'execution');
      executeScript({ script, fileName, channel });
    }
  });

  app.post('/api/test/run-sync', async (req, res) => {
    const { script, fileName } = req.body;
    if (!script) return res.status(400).json({ error: 'script is required' });

    const scriptName = fileName ? fileName.replace(/[\\/:*?"<>|]/g, '_') : `playwright-test-${Date.now()}.js`;
    const scriptPath = path.join(TMP_DIR, scriptName);
    writeFileSync(scriptPath, script, 'utf-8');

    const beforeFiles = new Set(readdirSync(TMP_DIR).filter(f => f.endsWith('.png')));
    const runJsPath = path.join(SKILL_DIR, 'run.cjs');

    if (!existsSync(runJsPath)) {
      cleanupScriptFile(scriptPath);
      return res.status(500).json({ error: `run.cjs not found` });
    }

    try {
      const { stdout, stderr, code } = await new Promise((resolve, reject) => {
        const child = spawn('node', [runJsPath, scriptPath], {
          cwd: SKILL_DIR,
          env: { ...process.env, PLAYWRIGHT_SKIP_EXISTING: '1' },
        });
        let out = '', err = '';
        child.stdout.on('data', c => out += c);
        child.stderr.on('data', c => err += c);
        child.on('close', code => resolve({ stdout: out, stderr: err, code }));
        child.on('error', reject);
      });

      const afterFiles = readdirSync(TMP_DIR).filter(f => f.endsWith('.png'));
      const screenshots = afterFiles.filter(f => !beforeFiles.has(f)).map(f => ({
        fileName: f,
        url: `/api/test/screenshots/${f}`,
      }));

      const { scriptErrors, success } = checkScriptErrors(scriptPath, code, 'sync');

      res.json({
        success,
        exitCode: code,
        stdout: stdout.slice(-2000),
        stderr: stderr.slice(-2000),
        screenshots,
        ...(scriptErrors && scriptErrors.length > 0 ? { scriptErrors, needsFix: true } : {}),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      cleanupScriptFile(scriptPath);
    }
  });
}
