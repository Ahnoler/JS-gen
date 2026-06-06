import { writeFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { TMP_DIR, SKILL_DIR } from '../config.js';
import { cleanupScriptFile } from '../script-utils.js';

function killOrphanChrome() {
  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name='chrome.exe'\\" | Where-Object { $_.CommandLine -match 'remote.debugging.(port|pipe)|playwright|openclaw|xbrowser' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
        { stdio: 'ignore', timeout: 5000, windowsHide: true }
      );
    }
  } catch {}
}

export default function (app) {
  app.post('/api/test/run', (req, res) => {
    const { script, fileName } = req.body;

    if (!script) return res.status(400).json({ error: 'script is required' });

    // Kill orphan Chrome processes from previous runs
    killOrphanChrome();

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

    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let aborted = false;
    res.on('close', () => { aborted = true; });

    const scriptName = fileName ? fileName.replace(/[\\/:*?"<>|]/g, '_') : `playwright-test-${Date.now()}.js`;
    const scriptPath = path.join(TMP_DIR, scriptName);
    writeFileSync(scriptPath, script, 'utf-8');
    send('log', { type: 'info', message: `Script saved: ${scriptPath}` });

    const beforeFiles = new Set(readdirSync(TMP_DIR).filter(f => f.endsWith('.png')));

    const runJsPath = path.join(SKILL_DIR, 'run.js');
    if (!existsSync(runJsPath)) {
      send('log', { type: 'error', message: `run.js not found at ${runJsPath}` });
      send('result', { success: false, error: `run.js not found` });
      send('done', {});
      cleanupScriptFile(scriptPath);
      res.end();
      return;
    }

    send('log', { type: 'step', message: `Executing: node run.js ${scriptPath}` });
    send('status', { phase: 'running', label: 'Executing Playwright script...' });

    const child = spawn('node', [runJsPath, scriptPath], {
      cwd: SKILL_DIR,
      env: { ...process.env, PLAYWRIGHT_SKIP_EXISTING: '1' },
    });

    res.on('close', () => {
      if (!child.killed) child.kill();
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

    child.on('close', (code) => {
      if (aborted) return;
      send('log', { type: 'step', message: `Process exited with code ${code}` });

      const afterFiles = readdirSync(TMP_DIR).filter(f => f.endsWith('.png'));
      const newScreenshots = afterFiles.filter(f => !beforeFiles.has(f));
      const screenshots = newScreenshots.map(f => ({
        fileName: f,
        url: `/api/test/screenshots/${f}`,
      }));

      if (screenshots.length > 0) {
        send('log', { type: 'success', message: `Captured ${screenshots.length} screenshot(s)` });
        send('screenshots', { screenshots });
      }

      const success = code === 0;
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
      cleanupScriptFile(scriptPath);
      res.end();
    });

    child.on('error', (err) => {
      if (aborted) return;
      send('log', { type: 'error', message: err.message });
      send('result', { success: false, error: err.message });
      send('done', {});
      cleanupScriptFile(scriptPath);
      res.end();
    });
  });

  app.post('/api/test/run-sync', async (req, res) => {
    const { script, fileName } = req.body;
    if (!script) return res.status(400).json({ error: 'script is required' });

    const scriptName = fileName ? fileName.replace(/[\\/:*?"<>|]/g, '_') : `playwright-test-${Date.now()}.js`;
    const scriptPath = path.join(TMP_DIR, scriptName);
    writeFileSync(scriptPath, script, 'utf-8');

    const beforeFiles = new Set(readdirSync(TMP_DIR).filter(f => f.endsWith('.png')));
    const runJsPath = path.join(SKILL_DIR, 'run.js');

    if (!existsSync(runJsPath)) {
      cleanupScriptFile(scriptPath);
      return res.status(500).json({ error: `run.js not found` });
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

      res.json({
        success: code === 0,
        exitCode: code,
        stdout: stdout.slice(-2000),
        stderr: stderr.slice(-2000),
        screenshots,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      cleanupScriptFile(scriptPath);
    }
  });
}
